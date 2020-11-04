import { debounce } from 'lodash';
import { Icon, Slider } from 'antd';
import { usePinch, useWheel } from 'react-use-gesture';
import { useIntl } from 'react-intl';
import { v4 } from 'uuid';
import React, { 
  CSSProperties,
  forwardRef,
  MouseEvent,
  MouseEventHandler,
  ReactNode,
  Reducer,
  RefObject,
  useCallback,
  useContext,
  useEffect, 
  useImperativeHandle,
  useRef, 
  useReducer,
  useState, 
} from 'react';

import './SketchPad.less';
import { defaultToolOption } from './enums/Tool';
import { drawImage, Image, onImageComplete } from './ImageTool';
import { isMobileDevice, mapClientToCanvas } from './utils';
import { useZoomGesture } from './gesture';
import ConfigContext from './ConfigContext';
import EnableSketchPadContext from './contexts/EnableSketchPadContext';
import gridLines from './images/grid_lines';
import sketchStrokeCursor from './images/sketch_stroke_cursor';
import Tool, { ToolOption, LatexOption, EmojiOption, FormulaOption, Position, MAX_SCALE, MIN_SCALE, } from './enums/Tool';
import "katex/dist/katex.min.css";
import { BlockMath } from "react-katex";

import { 
  onSelectMouseDoubleClick, 
  onSelectMouseDown, 
  onSelectMouseMove, 
  onSelectMouseUp, 
  SELECT_PADDING,
} from './SelectTool';

import { 
  drawRectangle, 
  onShapeMouseDown, 
  onShapeMouseMove, 
  onShapeMouseUp, 
  Shape,
  useShapeDropdown,
} from './ShapeTool';

import { 
  drawHighlighter, 
  drawStroke,
  Highlighter,
  moveHighlighter,
  moveStroke, 
  onStrokeMouseDown, 
  onStrokeMouseMove, 
  onStrokeMouseUp, 
  Stroke, 
  useStrokeDropdown,
} from './StrokeTool';

import { 
  drawText, 
  font,
  onTextComplete,
  onTextMouseDown, 
  Text, 
  useTextDropdown
} from './TextTool';

import { 
  drawLatex, 
  fontLatex,
  onLatexComplete,
  onLatexMouseDown, 
  Latex, 
  useLatexDropdown,
} from './LatexTool';

import { 
  drawEmoji, 
  fontEmoji,
  onEmojiComplete,
  onEmojiMouseDown, 
  Emoji, 
  useEmojiDropdown,
} from './EmojiTool';

import { 
  drawFormula, 
  fontFormula,
  onFormulaComplete,
  onFormulaMouseDown, 
  Formula, 
  useFormulaDropdown,
} from './FormulaTool';

export interface SketchPadProps {
  currentTool: Tool;
  setCurrentTool: (tool: Tool) => void;
  currentToolOption: ToolOption;
  userId: string;
  scale: number;
  showEraserSize: any;
  setShowEraserSize: any;
  eraserSize: number;
  onScaleChange: (scale: number) => void;
  // controlled mode
  operations?: Operation[];
  onChange?: onChangeCallback;
  showGrid: boolean;
}

export type onChangeCallback = (newOperaton: Operation, operationsAfter: Operation[]) => void;

export type onSaveCallback = (image: {
  canvas: HTMLCanvasElement,
  dataUrl: string,
}) => void;

export type SketchPadRef = {
  selectImage: (image: string) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  save: (handleSave?: onSaveCallback) => void;
};

export type Remove = {
  operationId: string,
}

export type Operation = (Stroke | Shape | Text | Latex | Emoji | Formula | Image | Update | Remove | Highlighter) & {
  id: string;
  userId: string;
  timestamp: number;
  pos: Position;
  tool: Tool;
};

export type Update = {
  operationId: string,
  data: Partial<((Stroke | Shape | Text | Latex | Emoji | Formula | Image | Highlighter) & {
    pos: Position,
  })>,
};

const DPR = window.devicePixelRatio || 1;

const SELECT_BOX_PADDING = 3;

const stopPropagation: MouseEventHandler = (e) => e.stopPropagation();

export type OperationListState = {
  queue: Operation[],
  reduced: Operation[],
}

const reduceOperations = (operations: Operation[]): Operation[] => {
  const undoHistory: Operation[] = [];

  operations = operations
    .sort((a, b) => a.timestamp - b.timestamp)
    .reduce((r: Operation[], v) => {
      switch (v.tool) {
        case Tool.Undo:
          if (r.length) {
            undoHistory.push(r.pop() as Operation);
          }
          break;
        case Tool.Redo:
          if (undoHistory.length) {
            r.push(undoHistory.pop() as Operation);
          }
          break;
        default:
          undoHistory.splice(0);
          r.push(v);
          break;
      }

      return r;
    }, []);

  let clearIndex: number = -1;
  while ((clearIndex = operations.findIndex(v => v.tool === Tool.Clear)) > 0) {
    operations = operations.slice(clearIndex);
  }

  operations.forEach((v, k) => {
    if (v.tool === Tool.Update) {
      const update = v as Update;
      const targetIndex = operations.findIndex(w => w && w.id === update.operationId);

      if (~targetIndex) {
        const target = operations[targetIndex];
        // @ts-ignore
        operations[targetIndex] = { ...operations[targetIndex], ...update.data };

        // move other properties related to pos
        if (update.data.pos) {
          switch (target.tool) {
            case Tool.Highlighter:
              operations[targetIndex] = { 
                ...operations[targetIndex], 
                ...{ 
                  points: moveHighlighter(target as Highlighter, target.pos, update.data.pos)
                } 
              };
            case Tool.Eraser:
              break;
            case Tool.Stroke:
              operations[targetIndex] = { 
                ...operations[targetIndex], 
                ...{ points: moveStroke(target as Stroke, target.pos, update.data.pos) 
                } 
              };
              break;
            case Tool.Shape: {
              const newOperation: any = ({ ...operations[targetIndex] });
              newOperation.start = {
                x: newOperation.pos.x,
                y: newOperation.pos.y,
              };
              newOperation.end = {
                x: newOperation.pos.x + newOperation.pos.w,
                y: newOperation.pos.y + newOperation.pos.h,
              };
              operations[targetIndex] = { ...newOperation };
              break;
            }
            default:
              break;
          }
        }
      }
    }
  })

  const removeIds = operations.filter(v => v.tool === Tool.Remove).map(v => (v as Remove).operationId);
  operations = operations.filter(v => v.tool !== Tool.Update && removeIds.indexOf(v.id) < 0); // keep Remove operation to keep undoable

  return operations;
}

const operationListReducer: (isControlled: boolean, onChange: onChangeCallback | undefined) => Reducer<OperationListState, any> = (isControlled, onChange) => (state, action) => {
  switch (action.type) {
    case 'add': {
      let operation = action.payload.operation as Operation;
      const isLazy = action.payload.isLazy;
      const newQueue = state.queue.concat([operation]);

      if (!isControlled || isLazy) {
        return {
          queue: newQueue,
          reduced: reduceOperations(newQueue),
        };
      } else {
        onChange && onChange(operation, newQueue);
        return state;
      }
    }
    case 'replaceLast': {
      let operation = action.payload.operation as Operation;
      const newQueue = state.queue.slice(0, -1).concat([operation]);

      return {
        queue: newQueue,
        reduced: reduceOperations(newQueue),
      }
    }
    case 'replaceAll': {
      let newQueue = action.payload.queue as Operation[];

      return {
        queue: newQueue,
        reduced: reduceOperations(newQueue),
      }
    }
    case 'completeLazyUpdate': {
      let operation = state.queue[state.queue.length - 1];
      if (isControlled && operation && operation.tool === Tool.Update) {
        onChange && onChange(operation, state.queue);
      }

      return state;
    }

    default:
      return state;
  }
}

enum ResizeDirection {
  TopLeft = 'TopLeft',
  TopCenter = 'TopCenter',
  MiddleRight = 'MiddleRight',
  MiddleLeft = 'MiddleLest',
  BottomRight = 'BottomRight',
  BottomCenter = 'BottomCenter',
  BottomLeft = 'BottomLeft',
};

let isResizing: null | ResizeDirection = null;
let startResizePoint: [number, number] = [0, 0];
let startResizePos: Position | null = null;
const useResizeHandler = (
  selectedOperation: Operation | null,
  viewMatrix: number[],
  scale: number,
  items: Operation[],
  operationListDispatch: React.Dispatch<any>,
  setSelectedOperation: (operation: Operation) => void,
  handleCompleteOperation: (tool?: Tool, data?: Stroke | Shape | Text | Image | Update | Remove | Highlighter, pos?: Position) => void,
  refCanvas: RefObject<HTMLCanvasElement>,
  prefixCls: string,
): {
  onMouseMove: (e: {
    clientX: number, clientY: number
  }) => void,
  onMouseUp: (e: {
    clientX: number, clientY: number
  }) => void,
  resizer: ReactNode,
} => {
  if (selectedOperation && (selectedOperation.tool === Tool.Shape || selectedOperation.tool === Tool.Image || selectedOperation.tool === Tool.Emoji || selectedOperation.tool === Tool.Stroke)) {
    const [a, b, c, d, e, f] = viewMatrix;
    const pos = {
      x: selectedOperation.pos.x - SELECT_BOX_PADDING,
      y: selectedOperation.pos.y - SELECT_BOX_PADDING,
      w: selectedOperation.pos.w + 2 * SELECT_BOX_PADDING,
      h: selectedOperation.pos.h + 2 * SELECT_BOX_PADDING,
    };

    const tl = [a * pos.x + c * pos.y + e, b * pos.x + d * pos.y + f];
    const br = [a * (pos.x + pos.w) + c * (pos.y + pos.h) + e, b * (pos.x + pos.w) + d * (pos.y + pos.h) + f];
    const w = br[0] - tl[0], h = br[1] - tl[1];

    const onMouseDown = (direction: ResizeDirection) => (e: MouseEvent) => {
      e.stopPropagation();

      if (refCanvas.current) {
        isResizing = direction;
        startResizePoint = mapClientToCanvas(e, refCanvas.current, viewMatrix);
        startResizePos = { ...selectedOperation.pos };
      }
    }

    const onTouchStart = (direction: ResizeDirection) => (e: React.TouchEvent) => {
      e.stopPropagation();

      if (refCanvas.current && e.touches[0]) {
        isResizing = direction;
        startResizePoint = mapClientToCanvas(e.touches[0], refCanvas.current, viewMatrix);
        startResizePos = { ...selectedOperation.pos };
      }
    }

    const onMouseMove = (e: {
      clientX: number,
      clientY: number,
    }) => {
      if (selectedOperation && isResizing && refCanvas.current && startResizePos) {
        let pos = mapClientToCanvas(e, refCanvas.current, viewMatrix);

        const diff = {
          x: pos[0] - startResizePoint[0],
          y: pos[1] - startResizePoint[1],
        };

        const updatePos = {
          ...startResizePos,
        };

        if (isResizing === ResizeDirection.TopLeft) {
          diff.x = Math.min(diff.x, updatePos.w);
          diff.y = Math.min(diff.y, updatePos.h);
          updatePos.x += diff.x;
          updatePos.y += diff.y;
          updatePos.w -= diff.x;
          updatePos.h -= diff.y;
        } else if (isResizing === ResizeDirection.TopCenter) {
          diff.y = Math.min(diff.y, updatePos.h);
          updatePos.y += diff.y;
          updatePos.h -= diff.y;
        } else if (isResizing === ResizeDirection.MiddleRight) {
          diff.x = Math.max(diff.x, -updatePos.w);
          updatePos.w += diff.x;
        } else if (isResizing === ResizeDirection.BottomRight) {
          diff.x = Math.max(diff.x, -updatePos.w);
          diff.y = Math.max(diff.y, -updatePos.h);
          updatePos.w += diff.x;
          updatePos.h += diff.y;
        } else if (isResizing === ResizeDirection.BottomCenter) {
          diff.y = Math.max(diff.y, -updatePos.h);
          updatePos.h += diff.y;
        } else if (isResizing === ResizeDirection.BottomLeft) {
          diff.y = Math.max(diff.y, -updatePos.h);
          diff.x = Math.min(diff.x, updatePos.w);
          updatePos.x += diff.x;
          updatePos.w -= diff.x;
          updatePos.h += diff.y;
        } else if (isResizing === ResizeDirection.MiddleLeft) {
          diff.x = Math.min(diff.x, updatePos.w);
          updatePos.x += diff.x;
          updatePos.w -= diff.x;
        }

        const lastOperation = items[items.length - 1];
        if (lastOperation && lastOperation.tool === Tool.Update && (lastOperation as Update).operationId === selectedOperation.id && (lastOperation as Update).data.pos) {
          const update = lastOperation as Update;
          if (update.data.pos) {
            update.data.pos = {
              ...updatePos,
            };
  
            operationListDispatch({
              type: 'replaceLast',
              payload: {
                operation: update,
              },
            });
          }
        } else {
          handleCompleteOperation(Tool.LazyUpdate, {
            operationId: selectedOperation.id,
            data: {
              pos: { ...updatePos },
            },
          });
        }

        setSelectedOperation({...selectedOperation, pos: { ...updatePos }});
      }
    }

    const onMouseUp = () => {
      operationListDispatch({
        type: 'completeLazyUpdate',
      });

      isResizing = null;
    }

    return {
      onMouseMove,
      onMouseUp,
      resizer: (
        <>
          <div key={ResizeDirection.TopLeft} onTouchStart={onTouchStart(ResizeDirection.TopLeft)} onMouseDown={onMouseDown(ResizeDirection.TopLeft)} className={`${prefixCls}-resizer`} style={{ left: tl[0] + 'px', top: tl[1] + 'px' }} />
          <div key={ResizeDirection.TopCenter} onTouchStart={onTouchStart(ResizeDirection.TopCenter)} onMouseDown={onMouseDown(ResizeDirection.TopCenter)} className={`${prefixCls}-resizer`} style={{ left: tl[0] + w / 2 + 'px', top: tl[1] + 'px' }} />
          <div key={ResizeDirection.MiddleRight} onTouchStart={onTouchStart(ResizeDirection.MiddleRight)} onMouseDown={onMouseDown(ResizeDirection.MiddleRight)} className={`${prefixCls}-resizer`} style={{ left: tl[0] + w + 'px', top: tl[1] + h / 2 + 'px' }} />
          <div key={ResizeDirection.BottomRight} onTouchStart={onTouchStart(ResizeDirection.BottomRight)} onMouseDown={onMouseDown(ResizeDirection.BottomRight)} className={`${prefixCls}-resizer`} style={{ left: br[0] + 'px', top: br[1] + 'px' }} />
          <div key={ResizeDirection.BottomCenter} onTouchStart={onTouchStart(ResizeDirection.BottomCenter)} onMouseDown={onMouseDown(ResizeDirection.BottomCenter)} className={`${prefixCls}-resizer`} style={{ left: br[0] - w / 2 + 'px', top: br[1] + 'px' }} />
          <div key={ResizeDirection.BottomLeft} onTouchStart={onTouchStart(ResizeDirection.BottomLeft)} onMouseDown={onMouseDown(ResizeDirection.BottomLeft)} className={`${prefixCls}-resizer`} style={{ left: br[0] - w + 'px', top: br[1] + 'px' }} />
          <div key={ResizeDirection.MiddleLeft} onTouchStart={onTouchStart(ResizeDirection.MiddleLeft)} onMouseDown={onMouseDown(ResizeDirection.MiddleLeft)} className={`${prefixCls}-resizer`} style={{ left: tl[0] + 'px', top: tl[1] + h / 2 + 'px' }} />
        </>
      )
    }
  } else return {
    onMouseMove: () => {},
    onMouseUp: () => {},
    resizer: null,
  };
}

const SketchPad: React.ForwardRefRenderFunction<any, SketchPadProps> = (props, ref) => {
  const { currentTool, setCurrentTool, userId, currentToolOption, onScaleChange, scale, operations, onChange, setShowEraserSize, showEraserSize, eraserSize, showGrid } = props;

  const refCanvas = useRef<HTMLCanvasElement>(null);
  const refContext = useRef<CanvasRenderingContext2D | null>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const lastTapRef = useRef<number>(0);
  const intl = useIntl();
  const { prefixCls } = useContext(ConfigContext);
  const enableSketchPadContext = useContext(EnableSketchPadContext);
  const [ currentMenuStyle, setCurrentMenuStyle ] = useState<CSSProperties | null>(null);
  const sketchpadPrefixCls = prefixCls + '-sketchpad';
  const [ showEmojiMenu, setShowEmojiMenu ] = useState(false);
  const [ showFormulaMenu, setShowFormulaMenu ] = useState(false);
  const [ showTextArea, setShowTextArea] = useState(false);
  const [ latexValue, setLatexValue] = useState('');
  const [ latexFontSize, setLatexFontSize ] = useState(12);

  const [ showLatexMenu, setShowLatexMenu ] = useState(false);
  const [ currentTop, setCurrentTop ] = useState<any>('');
  const [ currentLeft, setCurrentLeft ] = useState<any>('');
  const [viewMatrix, setViewMatrix] = useState([1, 0, 0, 1, 0, 0]);
  const [ showSettings, setShowSettings ] = useState('');
  const [ currentInput, setCurrentInput ] = useState('')
  const [scaleGrid, setScaleGrid] = useState(30);
  const [ currentEmoji, setCurrentEmoji ] = useState('');
  const [ currentFormula, setCurrentFormula ] = useState('');
  const [ latexGroup, setLatexGroup] = useState('Math');
  const [pdfFile, setPdfFile] = useState(null);
  const [videoList, setVideoList] = useState([]);
  const [cacheVids, setCacheVids] = useState({});

  const [ currentLatex, setCurrentLatex ] = useState('');
  const [ latexLeftPosition, setLatexLeftPosition ] = useState(null);
  const [ latexTopPosition, setLatexTopPosition ] = useState(null);

  const [hoverOperationId, setHoverOperationId] = useState<string | null>(null);
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null);

  const isControlled = !!operations;
  const reducer = useCallback(operationListReducer(isControlled, onChange), []);
  const [operationListState, operationListDispatch] = useReducer<Reducer<OperationListState, any>>(reducer, {
    queue: [],
    reduced: [],
  });
  if (isControlled) {
    useEffect(() => {
      operationListDispatch({
        type: 'replaceAll',
        payload: {
          queue: operations,
        },
      });
    }, [(operations as Operation[]).length]);
  }

  const refOperationListState = useRef<OperationListState>(operationListState);
  refOperationListState.current = operationListState;

  const saveGlobalTransform = () => {
    if (!refContext.current) return;
    const context = refContext.current;
    context.save();
    context.scale(DPR, DPR);
    const [a, b, c, d, e, f] = viewMatrix;
    context.transform(a, b, c, d, e, f);
    context.font = DPR + 'px';
  }

  const restoreGlobalTransform = () => {
    if (!refContext.current) return;
    const context = refContext.current;
    context.restore();
  }

  const renderOperations = (operations: Operation[]) => {
    console.log(operations)
    if (!refContext.current) return;
    const context = refContext.current;
    // clear canvas
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);

    saveGlobalTransform();
    operations.forEach((operation) => {
      const hover = (!selectedOperation || selectedOperation.id !== operation.id) && operation.id === hoverOperationId;

      switch (operation.tool) {
        case Tool.Clear:
          restoreGlobalTransform();
          context.clearRect(0, 0, context.canvas.width, context.canvas.height);
          saveGlobalTransform();
          break;
        case Tool.Eraser:
        case Tool.Highlighter:
        case Tool.Stroke:
          if(operation.tool === Tool.Stroke || operation.tool === Tool.Eraser) {
            drawStroke(operation as Stroke, context, hover);
          } else {
            drawHighlighter(operation as Highlighter, context, hover);
          }
          break
        case Tool.Shape:
          drawRectangle(operation as Shape, context, hover);
          break
        case Tool.Text:
          drawText(operation as Text, context, operation.pos);
          break
        case Tool.Latex:
          drawLatex(operation as Latex, context, operation.pos);
          break
        case Tool.Emoji:
          drawEmoji(operation as Emoji, context, operation.pos);
          break
        case Tool.Formula:
          drawFormula(operation as Formula, context, operation.pos);
          break
        case Tool.Image:
          drawImage(operation as Image, context, operation.pos, operation.id, () => {
            renderOperations(operations);
          });
        default:
          break
      }
    });

    // selected box
    if (selectedOperation) {
      context.beginPath();
      context.lineWidth = 1;
      context.strokeStyle = '#d0d0d0';
      context.rect(selectedOperation.pos.x - SELECT_BOX_PADDING, selectedOperation.pos.y - SELECT_BOX_PADDING, selectedOperation.pos.w + 2 * SELECT_BOX_PADDING, selectedOperation.pos.h + 2 * SELECT_BOX_PADDING);
      context.stroke();
      context.closePath();
    }
    restoreGlobalTransform();
  }

  useEffect(() => {
    const keydownHandler = (evt: KeyboardEvent) => {
      const { keyCode } = evt;
      if (keyCode === 8 || keyCode === 46 ) {
        if (selectedOperation) {
          setSelectedOperation(null);
          handleCompleteOperation(Tool.Remove, { operationId: selectedOperation.id });
        }
      } else if (keyCode === 27) { // key 'esc'
        setSelectedOperation(null);
      }
    };
    addEventListener('keydown', keydownHandler);

    return () => removeEventListener('keydown', keydownHandler);
  }, [selectedOperation && selectedOperation.id]);

  useEffect(() => {
    const resizeHandler = debounce(() => {
      const canvas = refCanvas.current;
      if (canvas && refOperationListState.current) {
        // high resolution canvas.
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * DPR;
        canvas.height = rect.height * DPR;

        renderOperations(refOperationListState.current.reduced);
      }
    }, 200);
    addEventListener('resize', resizeHandler);

    return () => removeEventListener('resize', resizeHandler);
  }, []);

  useEffect(() => {
    renderOperations(operationListState.reduced);
  }, [operationListState.reduced, scale, viewMatrix, hoverOperationId, selectedOperation]);

  // disable default scrolling on mobile device.
  // refer: https://stackoverflow.com/questions/49500339/cant-prevent-touchmove-from-scrolling-window-on-ios
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      // only disable scroll when interact with this board.
      if (lastTapRef.current) {
        e.preventDefault();
      }
      onTouchMoveRef.current && onTouchMoveRef.current(e);
    };

    document.addEventListener('touchmove', handler, {
      passive: false,
    });

    return () => {
      document.removeEventListener('touchmove', handler);
    }
  }, []);

  const handleCompleteOperation = (tool?: Tool, data?: Stroke | Shape | Text | Latex | Emoji | Formula | Image | Update | Remove | Highlighter, pos?: Position) => {
    if (!tool) {
      renderOperations(operationListState.reduced);
      return;
    }
    const isLazy = tool === Tool.LazyUpdate;
    tool = isLazy ? Tool.Update : tool;

    const message = Object.assign({}, data, {
      id: v4(),
      userId,
      timestamp: Date.now(),
      pos: pos as Position,
      tool: tool as Tool,
    });

    operationListDispatch({
      type: 'add',
      payload: {
        operation: message,
        isLazy,
      },
    });
  }

  let settingMenu = null;
  let removeButton = null;
  let content = null;

  const {
    onMouseMove: onMouseResizeMove,
    onMouseUp: onMouseResizeUp,
    resizer,
  } = useResizeHandler(selectedOperation, viewMatrix, scale, operationListState.queue, operationListDispatch, setSelectedOperation, handleCompleteOperation, refCanvas, sketchpadPrefixCls);

  const onMouseDown = (e: {
    clientX: number,
    clientY: number,
  }) => {
    if (!refCanvas.current) return null;
    if (!enableSketchPadContext.enable) return null;

    const [x, y] = mapClientToCanvas(e, refCanvas.current, viewMatrix);

    switch (currentTool) {
      case Tool.Select:
        onSelectMouseDown(e, x, y, scale, operationListState, viewMatrix, setSelectedOperation);
        break;
      case Tool.Highlighter:
      case Tool.Stroke:
        onStrokeMouseDown(x, y, currentToolOption, currentTool);
        break;
      case Tool.Eraser: 
        setShowEraserSize(!showEraserSize)
        onStrokeMouseDown(x, y, {
          ...currentToolOption,
          strokeSize: eraserSize,
          strokeColor: 'rgba(255, 255, 255, 1)',
        }, currentTool);
        break;
      case Tool.Shape:
        onShapeMouseDown(x, y, currentToolOption);
        break;
      case Tool.Text:
        onTextMouseDown(e, currentToolOption, scale, refInput, refCanvas, intl);
        break;

      case Tool.Latex:
        setCurrentTop(e.clientY);
        setCurrentLeft(e.clientX);
        setLatexTopPosition(e.clientY);
        setLatexLeftPosition(e.clientX);
        onLatexMouseDown(e, currentToolOption, scale, refInput, refCanvas, intl, currentTool, setCurrentTool);
        break;

      case Tool.Emoji:
        if(!currentTop) {
          setCurrentTop(e.clientY);
          setCurrentLeft(e.clientX);
        }
        onEmojiMouseDown(e, currentToolOption, scale, refInput, refCanvas, intl, currentTool, setCurrentTool);
        break;
      case Tool.Formula:
        if(!currentTop) {
          setCurrentTop(e.clientY);
          setCurrentLeft(e.clientX);
        }
        onFormulaMouseDown(e, currentToolOption, scale, refInput, refCanvas, intl, currentTool, setCurrentTool);
        break;
      default:
        break;
    }
  };
  //OPERATION
  if (selectedOperation) {
    switch (selectedOperation.tool) {
      case Tool.Highlighter:
        content = useStrokeDropdown({
          highlighterSize: (selectedOperation as Highlighter).size,
          highlighterColor: (selectedOperation as Highlighter).color,
        } as ToolOption, (option: ToolOption) => {
          const data = {
            color: option.highlighterColor,
            size: option.highlighterSize,
          };

          handleCompleteOperation(Tool.Update, {
            operationId: selectedOperation.id,
            data,
          });

          setSelectedOperation({ ...selectedOperation, ...data });
        }, () => {}, prefixCls, selectedOperation.tool);
        break;
      case Tool.Stroke:
        content = useStrokeDropdown({
          strokeSize: (selectedOperation as Stroke).size,
          strokeColor: (selectedOperation as Stroke).color,
        } as ToolOption, (option: ToolOption) => {
          const data = {
            color: option.strokeColor,
            size: option.strokeSize,
          };

          handleCompleteOperation(Tool.Update, {
            operationId: selectedOperation.id,
            data,
          });

          setSelectedOperation({ ...selectedOperation, ...data });
        }, () => {}, prefixCls, selectedOperation.tool);
        break;
      case Tool.Shape:
        content = useShapeDropdown({
          shapeType: (selectedOperation as Shape).type,
          shapeBorderColor: (selectedOperation as Shape).color,
          shapeBorderSize: (selectedOperation as Shape).size,
        } as ToolOption, (option: ToolOption) => {
          const data = {
            type: option.shapeType,
            color: option.shapeBorderColor,
            size: option.shapeBorderSize,
          };

          handleCompleteOperation(Tool.Update, {
            operationId: selectedOperation.id,
            data,
          });

          setSelectedOperation({ ...selectedOperation, ...data });
        }, () => {}, prefixCls);
        break;
      case Tool.Text: {
        const textOperation: Text = selectedOperation as Text;
        content = useTextDropdown({
          textSize: textOperation.size,
          textColor: textOperation.color,
        } as ToolOption, (option: ToolOption) => {
          const data: Partial<Operation> = {
            color: option.textColor,
            size: option.textSize,
          };

          if (refContext.current && option.textSize !== textOperation.size) {
            const context = refContext.current;

            // font size has changed, need to update pos
            context.font = `${option.textSize}px ${font}`;
            context.textBaseline = 'alphabetic';
            // measureText does not support multi-line
            const lines = textOperation.text.split('\n');
            data.pos = {
              ...selectedOperation.pos,
              w: Math.max(...(lines.map(line => context.measureText(line).width))),
              h: lines.length * option.textSize,
            };
          }

          handleCompleteOperation(Tool.Update, {
            operationId: selectedOperation.id,
            data,
          });

          // @ts-ignore
          setSelectedOperation({ ...selectedOperation, ...data });
        }, () => {}, intl, prefixCls);
        break;
      } 

      case Tool.Latex: {
        const textOperation: Latex = selectedOperation as Latex;
        content = useLatexDropdown({
          latexSize: textOperation ? textOperation.size: 20,
          textColor: textOperation? textOperation.color: 'black',
        } as ToolOption, (option: ToolOption) => {
          const data: Partial<Operation> = {
            color: option.textColor,
            size: option.latexSize,
          };

          const textOperationSize = textOperation ? textOperation.size: 20;

          if (refContext.current && option.latexSize !== textOperationSize) {
            const context = refContext.current;

            // font size has changed, need to update pos
            context.font = `${option.latexSize}px ${fontLatex}`;
            context.textBaseline = 'alphabetic';
            // measureText does not support multi-line
            const lines = textOperation.text.split('\n');
            data.pos = {
              ...selectedOperation.pos,
              w: Math.max(...(lines.map(line => context.measureText(line).width))),
              h: lines.length * option.latexSize,
            };
          }

          handleCompleteOperation(Tool.Update, {
            operationId: selectedOperation.id,
            data,
          });

          // @ts-ignore
          setSelectedOperation({ ...selectedOperation, ...data });
        }, () => {}, intl, prefixCls);
        break;
      }

      case Tool.Emoji: {
        const textOperation: Emoji = selectedOperation as Emoji;
        content = useEmojiDropdown({
          emojiSize: textOperation ? textOperation.size: 20,
          textColor: textOperation? textOperation.color: 'black',
        } as ToolOption, (option: ToolOption) => {
          const data: Partial<Operation> = {
            color: option.textColor,
            size: option.emojiSize,
          };

          const textOperationSize = textOperation ? textOperation.size: 20;

          if (refContext.current && option.emojiSize !== textOperationSize) {
            const context = refContext.current;

            // font size has changed, need to update pos
            context.font = `${option.emojiSize}px ${fontEmoji}`;
            context.textBaseline = 'alphabetic';
            // measureText does not support multi-line
            const lines = textOperation.text.split('\n');
            data.pos = {
              ...selectedOperation.pos,
              w: Math.max(...(lines.map(line => context.measureText(line).width))),
              h: lines.length * option.emojiSize,
            };
          }

          handleCompleteOperation(Tool.Update, {
            operationId: selectedOperation.id,
            data,
          });

          // @ts-ignore
          setSelectedOperation({ ...selectedOperation, ...data });
        }, () => {}, intl, prefixCls);
        break;
      }

      case Tool.Formula: {
        const textOperation: Formula = selectedOperation as Formula;
        content = useFormulaDropdown({
          formulaSize: textOperation ? textOperation.size: 20,
          textColor: textOperation? textOperation.color: 'black',
        } as ToolOption, (option: ToolOption) => {
          const data: Partial<Operation> = {
            color: option.textColor,
            size: option.formulaSize,
          };

          const textOperationSize = textOperation ? textOperation.size: 20;

          if (refContext.current && option.formulaSize !== textOperationSize) {
            const context = refContext.current;

            // font size has changed, need to update pos
            context.font = `${option.formulaSize}px ${fontFormula}`;
            context.textBaseline = 'alphabetic';
            // measureText does not support multi-line
            const lines = textOperation.text.split('\n');
            data.pos = {
              ...selectedOperation.pos,
              w: Math.max(...(lines.map(line => context.measureText(line).width))),
              h: lines.length * option.formulaSize,
            };
          }

          handleCompleteOperation(Tool.Update, {
            operationId: selectedOperation.id,
            data,
          });

          // @ts-ignore
          setSelectedOperation({ ...selectedOperation, ...data });
        }, () => {}, intl, prefixCls);
        break;
      }
      default:
        break;
    }

    const resultRect = {
      xMin: selectedOperation.pos.x,
      xMax: selectedOperation.pos.x + selectedOperation.pos.w,
      yMin: selectedOperation.pos.y,
      yMax: selectedOperation.pos.y + selectedOperation.pos.h,
    };

    const [a, b, c, d, e, f] = viewMatrix;
    const selectPadding = Math.max(SELECT_PADDING * 1 / scale || 0, SELECT_PADDING);
    const left = resultRect.xMin;
    const top = resultRect.yMax + selectPadding;

    const menuStyle: CSSProperties = {
      position: 'absolute',
      left: (a * left + c * top + e),
      top: (b * left + d * top + f),
    };

    if(JSON.stringify(currentMenuStyle) 
    !== JSON.stringify(menuStyle) 
    || !currentMenuStyle )
      setCurrentMenuStyle(menuStyle)
    
  
    settingMenu = (
      <div style={menuStyle} onMouseDown={stopPropagation}>
        {content}
      </div>
    );

    const onRemoveOperation = (evt: React.TouchEvent | React.MouseEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
  
      if (selectedOperation) {
        setSelectedOperation(null);
        handleCompleteOperation(Tool.Remove, { operationId: selectedOperation.id });
      }
    }


    
    const removeX = selectedOperation.tool === Tool.Text || selectedOperation.tool === Tool.Latex || selectedOperation.tool === Tool.Emoji || selectedOperation.tool === Tool.Formula? resultRect.xMax - 5 / scale : resultRect.xMax - 7 / scale;
    const removeY = selectedOperation.tool === Tool.Text || selectedOperation.tool === Tool.Latex || selectedOperation.tool === Tool.Emoji || selectedOperation.tool === Tool.Formula ? resultRect.yMin - 11 / scale : resultRect.yMin - 9 / scale;
    const removeStyle: CSSProperties = {
      position: 'absolute',
      left: (a * removeX + c * removeY + e),
      top: (b * removeX + d * removeY + f),
      background: 'white',
      lineHeight: '16px',
      fontSize: '16px',
      borderRadius: '50%',
      cursor: 'pointer',
      color: '#f45b6c',
    };

    removeButton = (
      <div style={removeStyle} onMouseDown={onRemoveOperation} onTouchStart={onRemoveOperation}>
        <Icon type="close-circle" theme="filled" />
      </div>
    )
  }

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      if (e.timeStamp - lastTapRef.current < 300) {
        onDoubleClick(e.touches[0]);
      } else {
        onMouseDown(e.touches[0]);
      }
    }

    lastTapRef.current = e.timeStamp;
  }

  const onDoubleClick = (e: {
    clientX: number,
    clientY: number,
  }) => {
    if (!refCanvas.current) return null;

    const [x, y] = mapClientToCanvas(e, refCanvas.current, viewMatrix);

    switch (currentTool) {
      case Tool.Select:
        onSelectMouseDoubleClick(x, y, scale, operationListState, handleCompleteOperation, viewMatrix, refInput, refCanvas, intl, setCurrentTool);
        setSelectedOperation(null);
        break;
      default:
        setCurrentTool(Tool.Select);
        break;
    }
  };

  const onMouseMove = (e: {
    clientX: number,
    clientY: number,
  }) => {
    if (!refCanvas.current) return null;
    if (!enableSketchPadContext.enable) return null;

    onMouseResizeMove(e);

    const [x, y] = mapClientToCanvas(e, refCanvas.current, viewMatrix);

    switch (currentTool) {
      case Tool.Select:
        setShowEraserSize(false);
        onSelectMouseMove(e, x, y, scale, operationListState, selectedOperation, setViewMatrix, setHoverOperationId, handleCompleteOperation, operationListDispatch, setSelectedOperation);
        break;
      case Tool.Eraser:
      case Tool.Highlighter:
      case Tool.Stroke: {
        saveGlobalTransform();
        refContext.current && onStrokeMouseMove(x, y, refContext.current, currentTool);
        restoreGlobalTransform();
        break;
      }
      case Tool.Shape: {
        renderOperations(operationListState.reduced);
        saveGlobalTransform();
        refContext.current && onShapeMouseMove(x, y, refContext.current);
        restoreGlobalTransform();
        break;
      }
      default:
        break;
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      onMouseMove(e.touches[0]);
    }
  }
  const onTouchMoveRef = useRef(onTouchMove);
  useEffect(() => {
    onTouchMoveRef.current = onTouchMove;
  }, [onTouchMove]);

  const onMouseUp = (e: {
    clientX: number,
    clientY: number,
  }) => {
    if (!refCanvas.current) return null;
    if (!enableSketchPadContext.enable) return null;

    onMouseResizeUp(e);

    switch (currentTool) {
      case Tool.Select:
        onSelectMouseUp(operationListDispatch);
        break;
      case Tool.Eraser: {
        refContext.current && onStrokeMouseUp(setCurrentTool, handleCompleteOperation, Tool.Eraser);
        break;
      }
      case Tool.Highlighter:
      case Tool.Stroke: {
        refContext.current && onStrokeMouseUp(setCurrentTool, handleCompleteOperation, currentTool);
        break;
      }
      case Tool.Shape: {
        const [x, y] = mapClientToCanvas(e, refCanvas.current, viewMatrix);
        refContext.current && onShapeMouseUp(x, y, setCurrentTool, handleCompleteOperation);
        break;
      }
      default:
        break;
    }
  };

  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.changedTouches.length === 1) {
      onMouseUp(e.changedTouches[0]);
    }

    lastTapRef.current = 0;
  }

  const onWheel = (evt: {
    stopPropagation?: React.WheelEvent<HTMLCanvasElement>['stopPropagation'];
    deltaY: number;
    ctrlKey: boolean;
    clientX: number;
    clientY: number;
    forceWheel?: boolean;
  }) => {
    if (isMobileDevice && !evt.forceWheel) return;

    evt.stopPropagation && evt.stopPropagation();

    const { deltaY, ctrlKey } = evt;
    const [a, b, c, d, e, f] = viewMatrix;
    let newScale = a - (ctrlKey ? +deltaY : deltaY) / 1000;
    newScale = Math.max(Math.min(newScale, MAX_SCALE), MIN_SCALE);

    if (refCanvas.current) {
      const pos = mapClientToCanvas(evt, refCanvas.current, viewMatrix);
      const scaleChange = newScale - a;
      setScaleGrid(Math.round(newScale * 30));
      setViewMatrix([newScale, b, c, newScale, e - (pos[0] * scaleChange), f - (pos[1] * scaleChange)]);
    }

    setSelectedOperation(null);
    onScaleChange(newScale);
  };

  useEffect(() => {
    const canvas = refCanvas.current as HTMLCanvasElement;

    // high resolution canvas.
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * DPR;
    canvas.height = rect.height * DPR;
    refContext.current = canvas.getContext('2d');

    canvas.oncontextmenu = (e) => {
      e.preventDefault();
    }
  }, []);

  const canvasStyle: CSSProperties = {};
  if (currentTool === Tool.Stroke || currentTool === Tool.Highlighter) {
    canvasStyle.cursor = `url(${sketchStrokeCursor}) 0 14, crosshair`;
  } else if (currentTool === Tool.Shape) {
    canvasStyle.cursor = `crosshair`;
  } else if (currentTool === Tool.Text) {
    canvasStyle.cursor = `text`;
  }

  if (currentTool === Tool.Select) {
    canvasStyle.position = `unset`;
  } else {
    canvasStyle.position = `relative`;
  }


  const backgroundStyle: CSSProperties = {};
  backgroundStyle.backgroundImage = showGrid ? `url(${gridLines})`: 'none';
  backgroundStyle.backgroundRepeat = 'repeat' ;
  backgroundStyle.backgroundSize = scaleGrid;

  useZoomGesture(refCanvas);
  const bindPinch = usePinch((state) => {
    const { ctrlKey, origin, delta } = state;

    if (origin) {
      onWheel({
        deltaY: delta[0],
        ctrlKey,
        clientX: origin[0],
        clientY: origin[1],
        forceWheel: true,
      });
    }
  });

  const imperativeHandler = () => {
    useImperativeHandle(ref, () => {
      return {
        selectImage: (file: string) => {
          if (file && refCanvas.current) {
            if (file.slice(0, 10) === 'data:video') {
              const lastChar = file.substr(file.length - 16);
              setVideoList([
                { video: file, id: lastChar },
                ...videoList
              ]);
            } else if (file.slice(0, 20) === 'data:application/pdf') {
              const lastChar = file.substr(file.length - 16);
              setPdfFile({ pdf: file, id: lastChar });
            } else {
              onImageComplete(file, refCanvas.current, viewMatrix, handleCompleteOperation);
            }
          }
        },
        undo: () => {
          setSelectedOperation(null);
          if (operationListState.reduced.length) {
            handleCompleteOperation(Tool.Undo);
          }
        },
        redo: () => {
          setSelectedOperation(null);
  
          let isRedoable = 0;
          const queue = operationListState.queue;
          for (let i = queue.length - 1; i >= 0; i--) {
            if (queue[i].tool === Tool.Undo) {
              isRedoable++;
            } else if (queue[i].tool === Tool.Redo) {
              isRedoable--;
            } else {
              break;
            }
          }
  
          if (isRedoable > 0) {
            handleCompleteOperation(Tool.Redo);
          }
        },
        clear: () => {
          setSelectedOperation(null);
          handleCompleteOperation(Tool.Clear);
        },
        save: (handleSave?: onSaveCallback) => {
          if (refCanvas.current && refContext.current) {
            const canvas = refCanvas.current;
            const w = canvas.width;
            const h = canvas.height;
            const context = refContext.current;
            context.globalCompositeOperation = "destination-over";
            context.fillStyle = "#fff";
            context.fillRect(0, 0, w, h);
  
            const dataUrl = canvas.toDataURL('image/png');
  
            if (handleSave) {
              handleSave({
                canvas,
                dataUrl,
              });
            } else {
              const a = document.createElement('a');
              a.href = dataUrl;
              a.download = 'sketch.png';
              a.click();
            }
          }
        },
      };
    });
  }
  
  imperativeHandler();

  const bindWheel = useWheel((state) => {
    const { ctrlKey, event, delta } = state;

    if (event && 'clientX' in event) {
      onWheel({
        deltaY: delta[1],
        ctrlKey,
        clientX: event.clientX + 0,
        clientY: event.clientY + 0,
        forceWheel: true,
      });
    }
  });

  const showEmojiDropdown = () => {
    const emojiList = [ 
      EmojiOption.BackhandIndexPointingDown,
      EmojiOption.BackhandIndexPointingLeft,
      EmojiOption.BackhandIndexPointingRight,
      EmojiOption.BackhandIndexPointingUp,
      EmojiOption.BeamingFacewithSmilingEyes,
      EmojiOption.Boy,
      EmojiOption.Brain,
      EmojiOption.BriefCase,
      EmojiOption.ClapphingHands,
      EmojiOption.ConfoundedFace,
      EmojiOption.ConfusedFace,
      EmojiOption.CrossedFingers,
      EmojiOption.CryingFace,
      EmojiOption.Ear,
      EmojiOption.Eyes,
      EmojiOption.FlexedBiceps,
      EmojiOption.FoldedHands,
      EmojiOption.Girl,
      EmojiOption.Glasses,
      EmojiOption.GraduationCap,
      EmojiOption.GrimacingFace,
      EmojiOption.GrinningFacewithBigEyes,
      EmojiOption.GrinningFacewithSmilingEyes,
      EmojiOption.GrinningFacewithSweat,
      EmojiOption.GrinningSquintingFace,
      EmojiOption.Handshake,
      EmojiOption.HandwithFingersSplayed,
      EmojiOption.HuggingFace,
      EmojiOption.IndexPointingUp,
      EmojiOption.LeftFacingFist,
      EmojiOption.ManRaisingHand,
      EmojiOption.ManTeacher,
      EmojiOption.OKHand,
      EmojiOption.RaisedFist,
      EmojiOption.RaisedHand,
      EmojiOption.RaisingHands,
      EmojiOption.RightFacingFist,
      EmojiOption.ThinkingFace,
      EmojiOption.ThumbsDown,
      EmojiOption.ThumbsUp,
      EmojiOption.VictoryHand,
      EmojiOption.WavingHand,
      EmojiOption.Woman,
      EmojiOption.WomanTeacher,
      EmojiOption.WritingHand
    ];

    const emojiPosition: CSSProperties = currentMenuStyle ? currentMenuStyle : { position:'fixed', top: (currentTop ? currentTop + 30 : 300), left: (currentLeft ? currentLeft: 300)};
    
    const emojiStyles: any = {
      emojiPosition,
      emojiDisplay: {
        display: showEmojiMenu ? 'flex': 'none', 
        cursor: 'pointer', 
        fontSize: 25,
        flexWrap: 'wrap',
        width: 400,
        background: '#ffffff',
        boxShadow: '0px 1px 4px 0px rgba(0, 0, 0, 0.2)',
        borderRadius: 4,
        padding: 10,
      } 
    }
    
    return (
      <div 
        style={{...emojiStyles.emojiPosition, ...emojiStyles.emojiDisplay}}
        onClick={()=> {setShowEmojiMenu(false)}}
      >
        {emojiList.map( emojis => {
          return <div key={emojis} onMouseDown={stopPropagation} onClick={()=> setCurrentEmoji(emojis)}>
                    {emojis}
                 </div>
        })
        }
      </div>
    )
  }

  const showFormulaDropdown = () => {
    const formulaList = [ 
      FormulaOption.FOR_ALL,
      FormulaOption.COMPLEMENT,
      FormulaOption.PARTIAL_DIFFERENTIAL
    ];

    const formulaPosition: CSSProperties = currentMenuStyle ? currentMenuStyle : { position:'fixed', top: (currentTop ? currentTop + 30 : 300), left: (currentLeft ? currentLeft: 300)};
    
    const formulaStyles: any = {
      formulaPosition,
      formulaDisplay: {
        display: showFormulaMenu ? 'flex': 'none', 
        cursor: 'pointer', 
        fontSize: 25,
        flexWrap: 'wrap',
        width: 400,
        background: '#ffffff',
        boxShadow: '0px 1px 4px 0px rgba(0, 0, 0, 0.2)',
        borderRadius: 4,
        padding: 10,
      } 
    }
    
    return (
      <div 
        style={{...formulaStyles.formulaPosition, ...formulaStyles.formulaDisplay}}
        onClick={()=> {setShowFormulaMenu(false)}}
      >
        {formulaList.map( formulas => {
          return (
                <div className="katex-formula" style={{marginRight: 5, fontFamily: 'KaTeX_Size2'}} key={formulas} onMouseDown={stopPropagation} onClick={()=> setCurrentFormula(formulas)}>
                    {formulas}
                </div>)
        })
        }
      </div>
    )
  }

  //EMOJI REFINPUTS
  useEffect(() => {
    refInput.current.innerText = currentEmoji ? currentEmoji: refInput.current.innerText;
    onEmojiComplete(refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool);
    setShowSettings('');
    setShowEmojiMenu(false);    
  }, [currentEmoji, refInput]);

  useEffect(() => {
    refInput.current.innerText = currentFormula ? currentFormula: refInput.current.innerText;
    onFormulaComplete(refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool);
    setShowSettings('');
    setShowFormulaMenu(false);    
  }, [currentFormula, refInput]);


  const showLatexDropdown = () => {
    const mathLatex = [
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/sqrt.png',
        label: 'SquareRoot',
        defaultText: '\\sqrt{ab}',
      },
      
      {
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/widetilde.png',
        label: 'WideTilde',
        defaultText: '\\widetilde{ab}',
      },
      
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/overleftarrow.png',
        label: 'overleftarrow',
        defaultText: '\\overleftarrow{ba}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/overline.png',
        label: 'overline',
        defaultText: '\\overline{ab}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/overbrace.png',
        label: 'overbrace', 
        defaultText: '\\overbrace{ab}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/fdash.png',
        label: 'fdash',
        defaultText: 'f\'',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/xpk.png',
        label: 'xpk',
        defaultText: 'x^{k}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/limit.png',
        label: 'limit',
        defaultText: '\\lim_{a \\rightarrow b}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/matrix.png',
        label: 'matrix',
        defaultText: '\\begin{bmatrix}a & b \\\\c & d \\end{bmatrix}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/para.png',
        label: 'para',
        defaultText: '\\big(a\\big)',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/int.png',
        label: 'int',
        defaultText: '\\int_a^b x',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/sum.png',
        label: 'sum',
        defaultText: '\\sum_a^b x',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/prod.png',
        label: 'prod',
        defaultText: '\\prod_a^b x',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/bigcap.png',
        label: 'bigcap',
        defaultText: '\\bigcap_a^b x',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/bigotimes.png',
        label: 'bigotimes',
        defaultText: '\\bigotimes',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/widehat.png',
        label: 'widehat',
        defaultText: '\\widehat{ab}',
      },
  
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/overrightarrow.png',
        label: 'overrightarrow',
        defaultText: '\\overrightarrow{ab}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/underline.png',
        label: 'underline',
        defaultText: '\\underline{ab}',
      },
      
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/underbrace.png',
        label: 'underbrace',
        defaultText: '\\underbrace{ab}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/sqrtn.png',
        label: 'sqrtn',
        defaultText: '\\sqrt[n]{ab}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/frac.png',
        label: 'frac',
        defaultText: '\\frac{a}{b}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/xuk.png',
        label: 'xuk',
        defaultText: 'x_{k}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/partial.png',
        label: 'partial',
        defaultText: '\\frac{\\partial^nf}{\\partial x^n}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/select.png',
        label: 'select',
        defaultText: 'x =\\begin{cases}a & x = 0\\\\b & x > 0\\end{cases}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/curly.png',
        label: 'curly',
        defaultText: '\\big\\{a\\big\\}',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/oint.png',
        label: 'oint',
        defaultText: '\\oint_a^b x',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/bigsqcup.png',
        label: 'bigsqcup',
        defaultText: '\\bigsqcup_a^b x',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/coprod.png',
        label: 'coprod',
        defaultText: '\\coprod_a^b x',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/bigcup.png',
        label: 'bigcup',
        defaultText: '\\bigcup_a^b x',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/bigvee.png',
        label: 'bigvee',
        defaultText: '\\bigwedge_a^b x',
      },
  
      {
          
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/bigoplus.png',
        label: 'bigoplus',
        defaultText: '\\bigoplus',
      }
    ];

    const greekLatex = [
      {
        
      url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/alpha.png',
      label: 'alpha',
      defaultText: '\\alpha',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/beta.png',
        label: 'beta',
        defaultText: '\\beta',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/gamma.png',
        label: 'gamma',
        defaultText: '\\gamma',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/delta.png',
        label: 'delta',
        defaultText: '\\delta',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/epsilon.png',
        label: 'epsilon',
        defaultText: '\\epsilon',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/varepsilon.png',
        label: 'varepsilon',
        defaultText: '\\varepsilon',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/zeta.png',
        label: 'zeta',
        defaultText: '\\zeta',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/eta.png',
        label: 'eta',
        defaultText: '\\eta',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/theta.png',
        label: 'theta',
        defaultText: '\\theta',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/vartheta.png',
        label: 'vartheta',
        defaultText: '\\vartheta',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/kappa.png',
        label: 'kappa',
        defaultText: '\\kappa',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/lambda.png',
        label: 'lambda',
        defaultText: '\\lambda',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/mu.png',
        label: 'mu',
        defaultText: '\\mu',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/nu.png',
        label: 'nu',
        defaultText: '\\nu',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/Gammabig.png',
        label: 'Gammabig',
        defaultText: '\\Gamma',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/Deltabig.png',
        label: 'Deltabig',
        defaultText: '\\Delta',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/Thetabig.png',
        label: 'Thetabig',
        defaultText: '\\Theta',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/Lambdabig.png',
        label: 'Lambdabig',
        defaultText: '\\Lambda',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/Xibig.png',
        label: 'Xibig',
        defaultText: '\\Xi',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/Pibig.png',
        label: 'Pibig',
        defaultText: '\\Pi',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/xi.png',
        label: 'xi',
        defaultText: '\\xi',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/o.png',
        label: 'o',
        defaultText: ' o',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/pi.png',
        label: 'pi',
        defaultText: '\\pi',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/varpi.png',
        label: 'varpi',
        defaultText: '\\varpi',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/rho.png',
        label: 'rho',
        defaultText: '\\rho',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/varrho.png',
        label: 'varrho',
        defaultText: '\\varrho',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/sigma.png',
        label: 'sigma',
        defaultText: '\\sigma',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/varsigma.png',
        label: 'varsigma',
        defaultText: '\\varsigma',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/tau.png',
        label: 'tau',
        defaultText: '\\tau',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/upsilon.png',
        label: 'upsilon',
        defaultText: '\\upsilon',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/phi.png',
        label: 'phi',
        defaultText: '\\phi',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/varphi.png',
        label: 'varphi',
        defaultText: '\\varphi',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/chi.png',
        label: 'chi',
        defaultText: '\\chi',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/psi.png',
        label: 'psi',
        defaultText: '\\psi',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/omega.png',
        label: 'omega',
        defaultText: '\\omega',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/Sigmabig.png',
        label: 'Sigmabig',
        defaultText: '\\Sigma',
      },

      {
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/Upsilonbig.png',
        label: 'Upsilonbig',
        defaultText: '\\Upsilon',
      },

      {
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/Phibig.png',
        label: 'Phibig',
        defaultText: '\\Phi',
      },

      {
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/Psibig.png',
        label: 'Psibig',
        defaultText: '\\Psi',
      },

      {
        
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/greek/Omegabig.png',
        label: 'Omegabig',
        defaultText: '\\Omega',
      }
    ]

    const relationsLatex = [
      {
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/leq.png',
        label: 'leq',
        defaultText: '\\leq',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/prec.png',
        label: 'prec',
        defaultText: '\\prec',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/preceq.png',
        label: 'preceq',
        defaultText: '\\preceq',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/ll.png',
        label: 'll',
        defaultText: '\\ll',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/subset.png',
        label: 'subset',
        defaultText: '\\subset',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/subseteq.png',
        label: 'subseteq',
        defaultText: '\\subseteq',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/sqsubset.png',
        label: 'sqsubset',
        defaultText: '\\sqsubset',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/sqsubseteq.png',
        label: 'sqsubseteq',
        defaultText: '\\sqsubseteq',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/in.png',
        label: 'in',
        defaultText: '\\in',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/vdash.png',
        label: 'vdash',
        defaultText: '\\vdash>',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/gt.png',
        label: '',
        defaultText: '>',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/Join.png',
        label: 'Join',
        defaultText: '\\Join',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/smile.png',
        label: 'smile',
        defaultText: '\\smile',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/sim.png',
        label: 'sim',
        defaultText: '\\sim',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/asymp.png',
        label: 'asymp',
        defaultText: '\\asymp',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/equiv.png',
        label: 'equiv',
        defaultText: '\\equiv',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/mid.png',
        label: 'mid',
        defaultText: '\\mid',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/neq.png',
        label: 'neq',
        defaultText: '\\neq',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/perp.png',
        label: 'perp',
        defaultText: '\\perp',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/colon.png',
        label: 'colon',
        defaultText: ':',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/rhd.png',
        label: 'rhd',
        defaultText: '\\rhd',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/unrhd.png',
        label: 'unrhd',
        defaultText: '\\unrhd',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/geq.png',
        label: 'geq',
        defaultText: '\\geq',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/succ.png',
        label: 'succ',
        defaultText: '\\succ',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/succeq.png',
        label: 'succeq',
        defaultText: '\\succeq',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/gg.png',
        label: 'gg',
        defaultText: '\\gg',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/supset.png',
        label: 'supset',
        defaultText: '\\supset',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/supseteq.png',
        label: 'supseteq',
        defaultText: '\\supseteq',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/sqsupset.png',
        label: 'sqsupset',
        defaultText: '\\sqsupset',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/sqsupseteq.png',
        label: 'sqsupseteq',
        defaultText: '\\sqsupseteq',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/ni.png',
        label: 'ni',
        defaultText: '\\ni',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/dashv.png',
        label: 'dashv',
        defaultText: '\\dashv',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/lt.png',
        label: 'lt',
        defaultText: '<',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/bowtie.png',
        label: 'bowtie',
        defaultText: '\\bowtie',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/frown.png',
        label: 'frown',
        defaultText: '\\frown',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/simeq.png',
        label: 'simeq',
        defaultText: '\\simeq',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/approx.png',
        label: 'approx',
        defaultText: '\\approx',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/cong.png',
        label: 'cong',
        defaultText: '\\cong',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/parallel.png',
        label: 'parallel',
        defaultText: '\\parallel',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/doteq.png',
        label: 'doteq',
        defaultText: '\\doteq',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/models.png',
        label: 'models',
        defaultText: '\\models',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/propto.png',
        label: 'propto',
        defaultText: '\\propto',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/lhd.png',
        label: 'lhd',
        defaultText: '\\lhd',
      },

      {
      
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/relations/unlhd.png',
        label: 'unlhd',
        defaultText: '\\unlhd',
      }
    ];

    const logicLatex = [

      {
    
      url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/hat.png',
      label: 'hat',
      defaultText: '\\hat{a}',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/acute.png',
        label: 'acute',
        defaultText: '\\acute{a}',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/bar.png',
        label: 'bar',
        defaultText: '\\bar{a}',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/dot.png',
        label: 'dot',
        defaultText: '\\dot{a}',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/breve.png',
        label: 'breve',
        defaultText: '\\breve{a}',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/plus.png',
        label: 'plus',
        defaultText: '+',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/times.png',
        label: 'times',
        defaultText: '\\times',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/cap.png',
        label: 'cap',
        defaultText: '\\cap',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/cup.png',
        label: 'cup',
        defaultText: '\\cup',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/vee.png',
        label: 'vee',
        defaultText: '\\vee',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/setminus.png',
        label: 'setminus',
        defaultText: '\\setminus',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/bigtriangleup.png',
        label: 'bigtriangleup',
        defaultText: '\\bigtriangleup',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/triangleright.png',
        label: 'triangleright',
        defaultText: '\\triangleright',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/rhd.png',
        label: 'rhd',
        defaultText: '\\rhd',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/unrhd.png',
        label: 'unrhd',
        defaultText: '\\unrhd',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/oplus.png',
        label: 'oplus',
        defaultText: '\\oplus',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/otimes.png',
        label: 'otimes',
        defaultText: '\\otimes',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/odot.png',
        label: 'odot',
        defaultText: '\\odot',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/uplus.png',
        label: 'uplus',
        defaultText: '\\uplus',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/ast.png',
        label: 'ast',
        defaultText: '\\ast',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/check.png',
        label: 'check',
        defaultText: '\\check{a}',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/grave.png',
        label: 'grave',
        defaultText: '\\grave{a}',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/vec.png',
        label: 'vec',
        defaultText: '\\vec{a}',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/ddot.png',
        label: 'ddot',
        defaultText: '\\ddot{a}',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/tilde.png',
        label: 'tilde',
        defaultText: '\\tilde{a}',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/minus.png',
        label: 'minus',
        defaultText: '-',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/div.png',
        label: 'div',
        defaultText: '\\div',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/sqcup.png',
        label: 'sqcup',
        defaultText: '\\sqcup',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/wedge.png',
        label: 'wedge',
        defaultText: '\\wedge',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/wr.png',
        label: 'wr',
        defaultText: '\\wr',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/bigtriangledown.png',
        label: 'bigtriangledown',
        defaultText: '\\bigtriangledown',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/triangleleft.png',
        label: 'triangleleft',
        defaultText: '\\triangleleft',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/lhd.png',
        label: 'lhd',
        defaultText: '\\lhd',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/unlhd.png',
        label: 'unlhd',
        defaultText: '\\unlhd',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/ominus.png',
        label: 'ominus',
        defaultText: '\\ominus',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/oslash.png',
        label: 'oslash',
        defaultText: '\\oslash',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/bigcirc.png',
        label: 'bigcirc',
        defaultText: '\\bigcirc',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/amalg.png',
        label: 'amalg',
        defaultText: '\\amalg',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/star.png',
        label: 'star',
        defaultText: '\\star',
      },

      {
    
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/logic/bullet.png',
        label: 'bullet',
        defaultText: '\\bullet',
      },
    ]

    const latexPosition: CSSProperties = currentMenuStyle ? currentMenuStyle : { position:'fixed', top: (latexTopPosition ? latexTopPosition + 30 : 300), left: (latexLeftPosition ? latexLeftPosition: 300)};
    
    const latexStyles: any = {
      latexPosition,
      latexDisplay: {
        display: showLatexMenu ? 'flex': 'none', 
        cursor: 'pointer', 
        fontSize: 25,
        flexWrap: 'wrap',
        background: '#ffffff',
        boxShadow: 'rgba(0, 0, 0, 0.2) 0px 6px 16px 0px',
        borderRadius: 4,
        padding: 10,
      } 
    } 
    
    const handleLatexSize = (value) => {
      setLatexFontSize(value)
    }
    
    const latexGroupList = ["Math", "Greek", "Relations", "Logic"];

    return (
      <div 
        style={{height: 'auto', zIndex: 9, display: 'flex', flexDirection: 'column', position: 'fixed', bottom: 50, width: 'calc(100% - 100px)', maxWidth: 716, left: 50, ...latexStyles.latexDisplay}}  
      >
        <div
          style={{display: 'flex', justifyContent: 'space-between', paddingRight: 5}}
        >
        <input 
          type={'text'} 
          id={'latexInputContainer'}
          value={latexValue}
          style={{border: '1px solid #ececec', marginRight: 5, marginBottom: 10, padding: 5,
          width: '100%'}} 
          onChange={(e)=> setLatexValue(e.target.value)}/>
        <button 
        onClick={()=> setLatexValue('')} 
        style={{
          padding: 5,
          background: '#ffffff',
          color: 'black',
          textAlign: 'center',
          border: '1px solid #cecece',
          fontSize: 14,
          borderRadius: 4,
          marginBottom: 10
        }}>clear</button>
        </div>

        <div
          style={{
            display: 'flex',
          }}
          className={'latex-list'}
        >
          {latexGroupList.map( latexGroupItem => {
            return(
              <div
                className={'latext-list-item'} 
                key={latexGroupItem} 
                style={{opacity: latexGroupItem === latexGroup ? 1: 0.5}}
                onClick={()=> setLatexGroup(latexGroupItem)}
              >
                {latexGroupItem}
              </div>
            )
          })}
        </div>
        <div style={{display: 'flex', flexWrap: 'wrap'}}>
        {latexGroup === 'Math' && mathLatex.map( latexs => {
          return (
            <img 
              key={latexs.url}
              className={'img-latex'}
              style={{ marginBottom: 10}}
              onMouseDown={stopPropagation}
              alt={latexs.defaultText}
              onClick={(e)=> {
                e.preventDefault();
                const _toCurrentLatex = latexValue.toString() + latexs.defaultText;
                setLatexValue(_toCurrentLatex);
                setCurrentLatex(latexValue)
                setShowTextArea(true);
              }}
              src={latexs.url}
            />
          )
        })}

        {latexGroup === 'Greek' && greekLatex.map( latexs => {
          return (
            <img 
              key={latexs.url}
              className={'img-latex'}
              style={{ marginBottom: 10}}
              onMouseDown={stopPropagation}
              alt={latexs.defaultText}
              onClick={(e)=> {
                e.preventDefault();
                const _toCurrentLatex = latexValue.toString() + latexs.defaultText;
                setLatexValue(_toCurrentLatex);
                setCurrentLatex(latexValue)
                setShowTextArea(true);
              }}
              src={latexs.url}
            />
          )
        })}

        {latexGroup === 'Relations' && relationsLatex.map( latexs => {
          return (
            <img 
              key={latexs.url}
              className={'img-latex'}
              style={{ marginBottom: 10}}
              onMouseDown={stopPropagation}
              alt={latexs.defaultText}
              onClick={(e)=> {
                e.preventDefault();
                const _toCurrentLatex = latexValue.toString() + latexs.defaultText;
                setLatexValue(_toCurrentLatex);
                setCurrentLatex(latexValue)
                setShowTextArea(true);
              }}
              src={latexs.url}
            />
          )
        })}

        {latexGroup === 'Logic' && logicLatex.map( latexs => {
          return (
            <img 
              key={latexs.url}
              className={'img-latex'}
              style={{ marginBottom: 10}}
              onMouseDown={stopPropagation}
              alt={latexs.defaultText}
              onClick={(e)=> {
                e.preventDefault();
                const _toCurrentLatex = latexValue.toString() + latexs.defaultText;
                setLatexValue(_toCurrentLatex);
                setCurrentLatex(latexValue)
                setShowTextArea(true);
              }}
              src={latexs.url}
            />
          )
        })}
        </div>
        <div style={{width: '100%',display: 'flex', paddingTop: 20, justifyContent: 'space-between'}}>
          <div 
            id={'latexFontSlider'}
          >
            <Slider
              value={latexFontSize} 
              style={{width: 100}}
              min={12} 
              max={120} 
              onChange={handleLatexSize}>
            </Slider>
          </div>
          <button
            id={`formulaBtn`}
            onClick={(e)=> {
              e.preventDefault();
              e.stopPropagation();
              refInput.current.innerText = latexValue;
              onLatexComplete(refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool, latexFontSize);
              setShowSettings('');
              setShowLatexMenu(false);
            }}>Add Formula
          </button>
        </div>
      </div>
    )
  }

  const pdfUploaded = () => {
    const [cachePdf, setPdfCache] = useState({});
    const pdfStyles: any = {
      pdfDisplay: {
        display: Boolean(pdfFile) ? 'flex': 'none',
      }
    };

    if (Boolean(pdfFile)) {
      if(!cachePdf[pdfFile.id]) {
        fetch(pdfFile.pdf)
          .then(res => res.blob())
          .then(blob => {
            console.log(blob);
            let pdfIframe = document.createElement('iframe');
            let existingPdfIframe = document.getElementById('pdfIframe');
            
            let removePdf = document.createElement('div');

            // overwrite the existing pdf
            if (existingPdfIframe) {
              document.getElementById('pdfId').removeChild(existingPdfIframe);
            }

            pdfIframe.src = URL.createObjectURL(blob);
            pdfIframe.width = '900px';
            pdfIframe.height = '900px';
            pdfIframe.id = 'pdfIframe';

            removePdf.innerText = 'X CLOSE';
            removePdf.style.cursor = 'pointer';
            removePdf.onclick = () => {
              document.getElementById('pdfId').removeChild(pdfIframe);
              document.getElementById('pdfId').removeChild(removePdf);
            };

            document.getElementById('pdfId').appendChild(pdfIframe);
            document.getElementById('pdfId').appendChild(removePdf);

            setPdfCache({
              [pdfFile.id]: pdfFile.pdf,
            });
          })
          .catch(e => console.log(e));
      }
    }

    return (
      <div
        id="pdfId"
        style={{height: 'auto', zIndex: 0, flexDirection: 'column', position: 'fixed', top: 0, width: 'calc(100% - 100px)', maxWidth: 716, left: 50, ...pdfStyles.pdfDisplay}}  
      >
        
      </div>
    );
  };

  const videoUploaded = () => {
    Object.values(cacheVids).map((data: any) => {
      const toDelete = data.slice(17, 23);
      const dataId = data.slice(0, 16);

      if (toDelete === 'delete') {
        delete cacheVids[dataId];
      }
    });

    if (Boolean(videoList.length > 0)) {
      const latestVideo = videoList
        .find(({ id }) => id !== cacheVids[id]) || '';

      if (Boolean(latestVideo) && !cacheVids[latestVideo?.id]) {
        fetch(latestVideo.video)
          .then(res => res.blob())
          .then(blob => {
            let vid = document.createElement('video');
            let removeVid = document.createElement('div');
            let removeIcon = document.getElementById('removeIcon').lastChild.cloneNode(true);

            vid.controls = true;
            
            vid.src = URL.createObjectURL(blob);
            vid.id = latestVideo.id.concat('-video');
            vid.style.position = 'absolute';
            vid.style.top = Boolean(videoList.length > 1) 
              ? String(document.getElementById(videoList.slice(1)[0]?.id.concat('-video')).offsetHeight + 50).concat('px')
              : '50px';
            vid.style.left = '50px';
            vid.style.height = '300px';
            vid.style.width = '500px';

            document.getElementsByClassName(`${sketchpadPrefixCls}-container`)[0].prepend(vid);
            
            setCacheVids({
              [latestVideo.id]: latestVideo.id, ...cacheVids
            });

            removeVid.style.position = 'absolute';
            removeVid.style.cursor = 'pointer';
            removeVid.style.left = String(vid.offsetWidth + 50).concat('px');
            removeVid.style.top = vid.style.top;
            removeVid.id = latestVideo.id.concat('-close'); 
            removeVid.onclick = (() => {
              document.getElementsByClassName(`${sketchpadPrefixCls}-container`)[0].removeChild(document.getElementById(latestVideo.id.concat('-video')));
              document.getElementsByClassName(`${sketchpadPrefixCls}-container`)[0].removeChild(document.getElementById(latestVideo.id.concat('-close')));
              setVideoList(videoList.filter(({ id }) => id !== latestVideo.id ));
              setCacheVids({ 
                [latestVideo.id]: latestVideo.id.concat('-delete'), ...cacheVids
              });
            });

            removeVid.appendChild(removeIcon);

            document.getElementsByClassName(`${sketchpadPrefixCls}-container`)[0].appendChild(removeVid);
          })
          .catch(e => console.log(e));
      }
    }

    return (
      <div id="removeIcon" style={{ display: 'none' }}>
        <Icon type="close-circle" theme="filled" style={{ background: 'white', color: '#f45b6c' }}/>
      </div>
    );
  };
  
  return (  
    <div
      className={`${sketchpadPrefixCls}-container`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onMouseUp={onMouseUp}
      style={backgroundStyle}
    >
      <div id='app'></div>
      {showLatexDropdown()}
      {videoUploaded()}
      {pdfUploaded()}
      <canvas
        ref={refCanvas}
        onDoubleClick={onDoubleClick}
        className={`${sketchpadPrefixCls}-canvas`}
        style={canvasStyle}
        {...bindPinch()}
        {...bindWheel()}
      />
      <div
        ref={refInput}
        contentEditable
        style={{fontSize: `${12 * scale}px`, }}
        className={`${sketchpadPrefixCls}-textInput`}
        onBlur={() => {
          if(showSettings === 'Emoji') {
            setCurrentTool(Tool.Emoji)
          }
          else if(showSettings === 'Formula') {
            setCurrentTool(Tool.Formula)
          }
          else if(showSettings === 'Latex') {
            setCurrentTool(Tool.Latex)
          }
          else{
            onTextComplete(refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool);
            onLatexComplete(refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool, latexFontSize);
            setShowSettings('')
          }
        }}
        onFocus={() => {
          setShowSettings(currentTool)
          if(currentTool === "Emoji") {
            setShowEmojiMenu(true)
          }
          else if(currentTool === "Formula") {
            setShowFormulaMenu(true)
          }
          else if(currentTool === "Latex") {
            setShowLatexMenu(true)
          }
        }}
      >
      </div>
      <div style={{position:'fixed', top: latexTopPosition, left: latexLeftPosition,  fontSize: 32}}>
      </div>
      {showEmojiDropdown()}
      {showFormulaDropdown()}
      {settingMenu}
      {removeButton}
      {resizer}
    </div>
  );
}

export default forwardRef(SketchPad);