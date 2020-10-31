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
  if (selectedOperation && (selectedOperation.tool === Tool.Shape || selectedOperation.tool === Tool.Image || selectedOperation.tool === Tool.Text || selectedOperation.tool === Tool.Emoji || selectedOperation.tool === Tool.Stroke)) {
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
  const { currentTool, setCurrentTool, userId, currentToolOption, onScaleChange, scale, operations, onChange, setShowEraserSize, showEraserSize, eraserSize } = props;

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

  const [ showLatexMenu, setShowLatexMenu ] = useState(false);
  const [ currentTop, setCurrentTop ] = useState<any>('');
  const [ currentLeft, setCurrentLeft ] = useState<any>('');
  const [viewMatrix, setViewMatrix] = useState([1, 0, 0, 1, 0, 0]);
  const [ showSettings, setShowSettings ] = useState('');
  const [ currentEmoji, setCurrentEmoji ] = useState('');
  const [ currentFormula, setCurrentFormula ] = useState('');

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
        if(!currentTop) {
          setCurrentTop(e.clientY);
          setCurrentLeft(e.clientX);
          setLatexTopPosition(e.clientY);
          setLatexLeftPosition(e.clientX);
        }
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
        selectImage: (image: string) => {
          if (image && refCanvas.current) {
            onImageComplete(image, refCanvas.current, viewMatrix, handleCompleteOperation);
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
      FormulaOption.PARTIAL_DIFFERENTIAL,
      FormulaOption.THERE_EXISTS,
      FormulaOption.THERE_DOES_NOT_EXIST,
      FormulaOption.EMPTY_SET,
      FormulaOption.INCREMENT,
      FormulaOption.NABLA,
      FormulaOption.ELEMENT_OF,
      FormulaOption.NOT_AN_ELEMENT_OF,
      FormulaOption.SMALL_ELEMENT_OF,
      FormulaOption.CONTAINS_AS_MEMBER,
      FormulaOption.DOES_NOT_CONTAIN_AS_MEMBER,
      FormulaOption.SMALL_CONTAINS_AS_MEMBER,
      FormulaOption.END_OF_PROOF,
      FormulaOption.N_ARY_PRODUCT,
      FormulaOption.N_ARY_COPRODUCT,
      FormulaOption.N_ARY_SUMMATION,
      FormulaOption.MINUS_SIGN,
      FormulaOption.MINUS_OR_PLUS_SIGN,
      FormulaOption.DOT_PLUS,
      FormulaOption.DIVISION_SLASH,
      FormulaOption.SET_MINUS,
      FormulaOption.ASTERISK_OPERATOR,
      FormulaOption.RING_OPERATOR,
      FormulaOption.BULLET_OPERATOR,
      FormulaOption.SQUARE_ROOT,
      FormulaOption.CUBE_ROOT,
      FormulaOption.FOURTH_ROOT,
      FormulaOption.PROPORTIONAL_TO,
      FormulaOption.INFINITY,
      FormulaOption.RIGHT_ANGLE,
      FormulaOption.ANGLE,
      FormulaOption.MEASURED_ANGLE,
      FormulaOption.SPHERICAL_ANGLE,
      FormulaOption.DIVIDES,
      FormulaOption.DOES_NOT_DIVIDE,
      FormulaOption.PARALLEL_TO,
      FormulaOption.NOT_PARALLEL_TO,
      FormulaOption.LOGICAL_AND,
      FormulaOption.LOGICAL_OR,
      FormulaOption.INTERSECTION,
      FormulaOption.UNION,
      FormulaOption.INTEGRAL,
      FormulaOption.DOUBLE_INTEGRAL,
      FormulaOption.TRIPLE_INTEGRAL,
      FormulaOption.CONTOUR_INTEGRAL,
      FormulaOption.SURFACE_INTEGRAL,
      FormulaOption.VOLUME_INTEGRAL,
      FormulaOption.CLOCKWISE_INTEGRAL,
      FormulaOption.CLOCKWISE_CONTOUR_INTEGRAL,
      FormulaOption.ANTICLOCKWISE_CONTOUR_INTEGRAL,
      FormulaOption.THEREFORE,
      FormulaOption.BECAUSE,
      FormulaOption.RATIO,
      FormulaOption.PROPORTION,
      FormulaOption.DOT_MINUS,
      FormulaOption.EXCESS,
      FormulaOption.GEOMETRIC_PROPORTION,
      FormulaOption.HOMOTHETIC,
      FormulaOption.TILDE_OPERATOR,
      FormulaOption.REVERSED_TILDE,
      FormulaOption.INVERTED_LAZY_S,
      FormulaOption.SINE_WAVE,
      FormulaOption.WREATH_PRODUCT,
      FormulaOption.NOT_TILDE,
      FormulaOption.MINUS_TILDE,
      FormulaOption.ASYMPTOTICALLY_EQUAL_TO,
      FormulaOption.NOT_ASYMPTOTICALLY_EQUAL_TO,
      FormulaOption.APPROXIMATELY_EQUAL_TO,
      FormulaOption.APPROXIMATELY_BUT_NOT_ACTUALLY_EQUAL_TO,
      FormulaOption.NEITHER_APPROXIMATELY_NOR_ACTUALLY_EQUAL_TO,
      FormulaOption.ALMOST_EQUAL_TO,
      FormulaOption.NOT_ALMOST_EQUAL_TO,
      FormulaOption.ALMOST_EQUAL_OR_EQUAL_TO,
      FormulaOption.TRIPLE_TILDE,
      FormulaOption.ALL_EQUAL_TO,
      FormulaOption.EQUIVALENT_TO,
      FormulaOption.GEOMETRICALLY_EQUIVALENT_TO,
      FormulaOption.DIFFERENCE_BETWEEN,
      FormulaOption.APPROACHES_THE_LIMIT,
      FormulaOption.GEOMETRICALLY_EQUAL_TO,
      FormulaOption.APPROXIMATELY_EQUAL_TO_OR_THE_IMAGE_OF,
      FormulaOption.IMAGE_OF_OR_APPROXIMATELY_EQUAL_TO,
      FormulaOption.COLON_EQUALS,
      FormulaOption.EQUALS_COLON,
      FormulaOption.RING_IN_EQUAL_TO,
      FormulaOption.RING_EQUAL_TO,
      FormulaOption.CORRESPONDS_TO,
      FormulaOption.ESTIMATES,
      FormulaOption.EQUIANGULAR_TO,
      FormulaOption.STAR_EQUALS,
      FormulaOption.DELTA_EQUAL_TO,
      FormulaOption.EQUAL_TO_BY_DEFINITION,
      FormulaOption.MEASURED_BY,
      FormulaOption.QUESTIONED_EQUAL_TO,
      FormulaOption.NOT_EQUAL_TO,
      FormulaOption.IDENTICAL_TO,
      FormulaOption.NOT_IDENTICAL_TO,
      FormulaOption.STRICTLY_EQUIVALENT_TO,
      FormulaOption.LESS_THAN_OR_EQUAL_TO,
      FormulaOption.GREATER_THAN_OR_EQUAL_TO,
      FormulaOption.LESS_THAN_OVER_EQUAL_TO,
      FormulaOption.GREATER_THAN_OVER_EQUAL_TO,
      FormulaOption.LESS_THAN_BUT_NOT_EQUAL_TO,
      FormulaOption.GREATER_THAN_BUT_NOT_EQUAL_TO,
      FormulaOption.MUCH_LESS_THAN,
      FormulaOption.MUCH_GREATER_THAN,
      FormulaOption.BETWEEN,
      FormulaOption.NOT_EQUIVALENT_TO,
      FormulaOption.NOT_LESS_THAN,
      FormulaOption.NOT_GREATER_THAN,
      FormulaOption.NEITHER_LESS_THAN_NOR_EQUAL_TO,
      FormulaOption.NEITHER_GREATER_THAN_NOR_EQUAL_TO,
      FormulaOption.LESS_THAN_OR_EQUIVALENT_TO,
      FormulaOption.GREATER_THAN_OR_EQUIVALENT_TO,
      FormulaOption.NEITHER_LESS_THAN_NOR_EQUIVALENT_TO,
      FormulaOption.NEITHER_GREATER_THAN_NOR_EQUIVALENT_TO,
      FormulaOption.LESS_THAN_OR_GREATER_THAN,
      FormulaOption.GREATER_THAN_OR_LESS_THAN,
      FormulaOption.NEITHER_LESS_THAN_NOR_GREATER_THAN,
      FormulaOption.NEITHER_GREATER_THAN_NOR_LESS_THAN,
      FormulaOption.PRECEDES,
      FormulaOption.SUCCEEDS,
      FormulaOption.PRECEDES_OR_EQUAL_TO,
      FormulaOption.SUCCEEDS_OR_EQUAL_TO,
      FormulaOption.PRECEDES_OR_EQUIVALENT_TO,
      FormulaOption.SUCCEEDS_OR_EQUIVALENT_TO,
      FormulaOption.DOES_NOT_PRECEDE,
      FormulaOption.DOES_NOT_SUCCEED,
      FormulaOption.SUBSET_OF,
      FormulaOption.SUPERSET_OF,
      FormulaOption.NOT_A_SUBSET_OF,
      FormulaOption.NOT_A_SUPERSET_OF,
      FormulaOption.SUBSET_OF_OR_EQUAL_TO,
      FormulaOption.SUPERSET_OF_OR_EQUAL_TO,
      FormulaOption.NEITHER_A_SUBSET_OF_NOR_EQUAL_TO,
      FormulaOption.NEITHER_A_SUPERSET_OF_NOR_EQUAL_TO,
      FormulaOption.SUBSET_OF_WITH_NOT_EQUAL_TO,
      FormulaOption.SUPERSET_OF_WITH_NOT_EQUAL_TO,
      FormulaOption.MULTISET,
      FormulaOption.MULTISET_MULTIPLICATION,
      FormulaOption.MULTISET_UNION,
      FormulaOption.SQUARE_IMAGE_OF,
      FormulaOption.SQUARE_ORIGINAL_OF,
      FormulaOption.SQUARE_IMAGE_OF_OR_EQUAL_TO,
      FormulaOption.SQUARE_ORIGINAL_OF_OR_EQUAL_TO,
      FormulaOption.SQUARE_CAP,
      FormulaOption.SQUARE_CUP,
      FormulaOption.CIRCLED_PLUS,
      FormulaOption.CIRCLED_MINUS,
      FormulaOption.CIRCLED_TIMES,
      FormulaOption.CIRCLED_DIVISION_SLASH,
      FormulaOption.CIRCLED_DOT_OPERATOR,
      FormulaOption.CIRCLED_RING_OPERATOR,
      FormulaOption.CIRCLED_ASTERISK_OPERATOR,
      FormulaOption.CIRCLED_EQUALS,
      FormulaOption.CIRCLED_DASH,
      FormulaOption.SQUARED_PLUS,
      FormulaOption.SQUARED_MINUS,
      FormulaOption.SQUARED_TIMES,
      FormulaOption.SQUARED_DOT_OPERATOR,
      FormulaOption.RIGHT_TACK,
      FormulaOption.LEFT_TACK,
      FormulaOption.DOWN_TACK,
      FormulaOption.UP_TACK,
      FormulaOption.ASSERTION,
      FormulaOption.MODELS,
      FormulaOption.TRUE,
      FormulaOption.FORCES,
      FormulaOption.TRIPLE_VERTICAL_BAR_RIGHT_TURNSTILE,
      FormulaOption.DOUBLE_VERTICAL_BAR_DOUBLE_RIGHT_TURNSTILE,
      FormulaOption.DOES_NOT_PROVE,
      FormulaOption.NOT_TRUE,
      FormulaOption.DOES_NOT_FORCE,
      FormulaOption.NEGATED_DOUBLE_VERTICAL_BAR_DOUBLE_RIGHT_TURNSTILE,
      FormulaOption.PRECEDES_UNDER_RELATION,
      FormulaOption.SUCCEEDS_UNDER_RELATION,
      FormulaOption.NORMAL_SUBGROUP_OF,
      FormulaOption.CONTAINS_AS_NORMAL_SUBGROUP,
      FormulaOption.NORMAL_SUBGROUP_OF_OR_EQUAL_TO,
      FormulaOption.CONTAINS_AS_NORMAL_SUBGROUP_OR_EQUAL_TO,
      FormulaOption.ORIGINAL_OF,
      FormulaOption.IMAGE_OF,
      FormulaOption.MULTIMAP,
      FormulaOption.HERMITIAN_CONJUGATE_MATRIX,
      FormulaOption.INTERCALATE,
      FormulaOption.XOR,
      FormulaOption.NAND,
      FormulaOption.NOR,
      FormulaOption.RIGHT_ANGLE_WITH_ARC,
      FormulaOption.RIGHT_TRIANGLE,
      FormulaOption.N_ARY_LOGICAL_AND,
      FormulaOption.N_ARY_LOGICAL_OR,
      FormulaOption.N_ARY_INTERSECTION,
      FormulaOption.N_ARY_UNION,
      FormulaOption.DIAMOND_OPERATOR,
      FormulaOption.DOT_OPERATOR,
      FormulaOption.STAR_OPERATOR,
      FormulaOption.DIVISION_TIMES,
      FormulaOption.BOWTIE,
      FormulaOption.LEFT_NORMAL_FACTOR_SEMIDIRECT_PRODUCT,
      FormulaOption.RIGHT_NORMAL_FACTOR_SEMIDIRECT_PRODUCT,
      FormulaOption.LEFT_SEMIDIRECT_PRODUCT,
      FormulaOption.RIGHT_SEMIDIRECT_PRODUCT,
      FormulaOption.REVERSED_TILDE_EQUALS,
      FormulaOption.CURLY_LOGICAL_OR,
      FormulaOption.CURLY_LOGICAL_AND,
      FormulaOption.DOUBLE_SUBSET,
      FormulaOption.DOUBLE_SUPERSET,
      FormulaOption.DOUBLE_INTERSECTION,
      FormulaOption.DOUBLE_UNION,
      FormulaOption.PITCHFORK,
      FormulaOption.EQUAL_AND_PARALLEL_TO,
      FormulaOption.LESS_THAN_WITH_DOT,
      FormulaOption.GREATER_THAN_WITH_DOT,
      FormulaOption.VERY_MUCH_LESS_THAN,
      FormulaOption.VERY_MUCH_GREATER_THAN,
      FormulaOption.LESS_THAN_EQUAL_TO_OR_GREATER_THAN,
      FormulaOption.GREATER_THAN_EQUAL_TO_OR_LESS_THAN,
      FormulaOption.EQUAL_TO_OR_LESS_THAN,
      FormulaOption.EQUAL_TO_OR_GREATER_THAN,
      FormulaOption.EQUAL_TO_OR_PRECEDES,
      FormulaOption.EQUAL_TO_OR_SUCCEEDS,
      FormulaOption.DOES_NOT_PRECEDE_OR_EQUAL,
      FormulaOption.DOES_NOT_SUCCEED_OR_EQUAL,
      FormulaOption.NOT_SQUARE_IMAGE_OF_OR_EQUAL_TO,
      FormulaOption.NOT_SQUARE_ORIGINAL_OF_OR_EQUAL_TO,
      FormulaOption.SQUARE_IMAGE_OF_OR_NOT_EQUAL_TO,
      FormulaOption.SQUARE_ORIGINAL_OF_OR_NOT_EQUAL_TO,
      FormulaOption.LESS_THAN_BUT_NOT_EQUIVALENT_TO,
      FormulaOption.GREATER_THAN_BUT_NOT_EQUIVALENT_TO,
      FormulaOption.PRECEDES_BUT_NOT_EQUIVALENT_TO,
      FormulaOption.SUCCEEDS_BUT_NOT_EQUIVALENT_TO,
      FormulaOption.NOT_NORMAL_SUBGROUP_OF,
      FormulaOption.DOES_NOT_CONTAIN_AS_NORMAL_SUBGROUP,
      FormulaOption.NOT_NORMAL_SUBGROUP_OF_OR_EQUAL_TO,
      FormulaOption.DOES_NOT_CONTAIN_AS_NORMAL_SUBGROUP_OR_EQUAL,
      FormulaOption.VERTICAL_ELLIPSIS,
      FormulaOption.MIDLINE_HORIZONTAL_ELLIPSIS,
      FormulaOption.UP_RIGHT_DIAGONAL_ELLIPSIS,
      FormulaOption.DOWN_RIGHT_DIAGONAL_ELLIPSIS,
      FormulaOption.ELEMENT_OF_WITH_LONG_HORIZONTAL_STROKE,
      FormulaOption.ELEMENT_OF_WITH_VERTICAL_BAR_AT_END_OF_HORIZONTAL_STROKE,
      FormulaOption.SMALL_ELEMENT_OF_WITH_VERTICAL_BAR_AT_END_OF_HORIZONTAL_STROKE,
      FormulaOption.ELEMENT_OF_WITH_DOT_ABOVE,
      FormulaOption.ELEMENT_OF_WITH_OVERBAR,
      FormulaOption.SMALL_ELEMENT_OF_WITH_OVERBAR,
      FormulaOption.ELEMENT_OF_WITH_UNDERBAR,
      FormulaOption.ELEMENT_OF_WITH_TWO_HORIZONTAL_STROKES,
      FormulaOption.CONTAINS_WITH_LONG_HORIZONTAL_STROKE,
      FormulaOption.CONTAINS_WITH_VERTICAL_BAR_AT_END_OF_HORIZONTAL_STROKE,
      FormulaOption.SMALL_CONTAINS_WITH_VERTICAL_BAR_AT_END_OF_HORIZONTAL_STROKE,
      FormulaOption.CONTAINS_WITH_OVERBAR,
      FormulaOption.SMALL_CONTAINS_WITH_OVERBAR,
      FormulaOption.Z_NOTATION_BAG_MEMBERSHIP
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
    const latexList = [ 
      LatexOption.BigSquareCup,
      LatexOption.Product,
      LatexOption.SquareRoot,
      LatexOption.SquareRootN,
      LatexOption.Summation,
      LatexOption.WideTilde
    ];

    const latexOptions = [
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
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/frac.png',
        label: 'Fraction',
        defaultText: '\\frac{a}{b}'
      },
      {
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/sum.png',
        label: 'Summation',
        defaultText: '\\displaystyle\\sum_0^n',
      },
      {
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/prod.png',
        label: 'Product',
        defaultText: '\\prod_a^b x',
      },
      {
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/partial.png',
        label: 'Partial',
        defaultText: '\\frac{\\partial^nf}{\\partial x^n}'
      },
      {
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/bigsqcup.png',
        label: 'BigSquareCup',
        defaultText: '\\bigsqcup_a^b x',
      },
      {
        url: 'https://live.braincert.com/html5/build/images/www/assets/latex/math/sqrtn.png',
        label: 'SquareRootN',
        defaultText: '\\sqrt[n]{ab}',
      },
    ]

    const latexPosition: CSSProperties = currentMenuStyle ? currentMenuStyle : { position:'fixed', top: (currentTop ? currentTop + 30 : 300), left: (currentLeft ? currentLeft: 300)};
    
    const latexStyles: any = {
      latexPosition,
      latexDisplay: {
        display: showLatexMenu ? 'flex': 'none', 
        cursor: 'pointer', 
        fontSize: 25,
        flexWrap: 'wrap',
        width: 300,
        background: '#ffffff',
        boxShadow: '0px 1px 4px 0px rgba(0, 0, 0, 0.2)',
        borderRadius: 4,
        padding: 10,
      } 
    }

    const handleLatex = () => {
      refInput.current.innerText = refInput.current.innerText;
      refInput.current.style.display = 'none';
      console.log(refContext)
    }
    
    return (
      <div 
        style={{...latexStyles.latexPosition, ...latexStyles.latexDisplay}}
        onClick={()=> {setShowLatexMenu(false)}}
      >
        {latexOptions.map( latexs => {
          return (
            <img 
              key={latexs.url}
              style={{ marginBottom: 10 }}
              onMouseDown={stopPropagation}
              alt={latexs.defaultText}
              onClick={()=> setCurrentLatex(latexs.defaultText)}
              src={latexs.url}
            />
          )
        })}
        <button
          style={{
            fontSize: 14, 
            marginLeft: 'auto', 
            padding: 5,
            height: 34,
            lineHeight: 'normal'
          }} 
          onClick={handleLatex}>
            Add Latex
        </button>
      </div>
    )
  }

  //LATEX REFINPUTS
  useEffect(() => {
    refInput.current.innerText = currentLatex ? currentLatex: refInput.current.innerText;
    onLatexComplete(refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool);
    setShowSettings('');
  }, [currentLatex, refInput])
  
  return (
    <div
      className={`${sketchpadPrefixCls}-container`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onMouseUp={onMouseUp}
    >
      <div id='app'></div>
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
        style={{ fontSize: `${12 * scale}px`, }}
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
            onLatexComplete(refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool);
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
      <div style={{position:'fixed', top: latexTopPosition, left: latexLeftPosition, fontSize: 32}}>
          <BlockMath>
            {refInput.current?refInput.current.innerText:"c = pmsqrt{a^4 + b^8}"}
          </BlockMath> 
      </div>
      {showEmojiDropdown()}
      {showFormulaDropdown()}
      {showLatexDropdown()}
      {settingMenu}
      {removeButton}
      {resizer}
    </div>
  );
}

export default forwardRef(SketchPad);