import React from 'react';
import Tool, { strokeSize, strokeColor, ToolOption } from './enums/Tool';
import { isMobileDevice } from './utils';
import { Icon } from 'antd';
import './StrokeTool.less';

interface Point {
  x: number,
  y: number,
}

export interface Stroke {
  color: string,
  size: number,
  points: Point[],
}

export interface Highlighter {
  color: string,
  size: number,
  points: Point[],
}

export interface Eraser {
  color: string,
  size: number,
  points: Point[],
}

export interface Position {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Pencil and Highlighter tool
let highlighter: Highlighter | null = null;
let stroke: Stroke | null = null;

let points: Point[] = [];

const drawLineStroke = (context: CanvasRenderingContext2D, item: Stroke, start: Point, { x, y } : Point) => {
  context.globalAlpha = 1;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();
  context.lineWidth = item.size;
  context.strokeStyle = item.color;
  context.globalCompositeOperation = 'source-over';
  context.moveTo(start.x, start.y);

  const xc = (start.x + x) / 2;
  const yc = (start.y + y) / 2;
  context.quadraticCurveTo(xc, yc, x, y);

  context.closePath();
  context.stroke();
};

const drawLineHighlighter = (context: CanvasRenderingContext2D, item: Highlighter, start: Point, { x, y } : Point) => {
  context.globalAlpha = 0.3;
  context.beginPath();
  context.lineWidth = item.size;
  context.strokeStyle = item.color;
  context.globalCompositeOperation = 'source-over';
  context.moveTo(start.x, start.y);

  const xc = (start.x + x) / 2;
  const yc = (start.y + y) / 2;
  context.quadraticCurveTo(xc, yc, x, y);

  context.closePath();
  context.stroke();
};

export const drawStroke = (stroke: Stroke, context: CanvasRenderingContext2D, hover: boolean) => {
  const points = stroke.points.filter((_, index) => index % 2 === 0);
  if (points.length < 3) {
    return;
  };

  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();
  context.lineWidth = stroke.size;
  context.globalCompositeOperation = 'source-over';
  context.strokeStyle = hover ? '#3AB1FE' : stroke.color;
  context.globalAlpha = 1;


  // move to the first point
  context.moveTo(points[0].x, points[0].y);

  let i = 0;
  for (i = 1; i < points.length - 2; i++) {
    var xc = (points[i].x + points[i + 1].x) / 2 + 0.01;
    var yc = (points[i].y + points[i + 1].y) / 2 + 0.01;
    context.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }

  // curve through the last two points
  context.quadraticCurveTo(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);

  context.stroke();
}

export const drawHighlighter = (highlighter: Highlighter, context: CanvasRenderingContext2D, hover: boolean) => {
  const points = highlighter.points.filter((_, index) => index % 2 === 0);
  if (points.length < 3) {
    return;
  };
  context.globalAlpha = 0.3;
  context.lineJoin = 'miter';
  context.lineCap = 'square';
  context.beginPath();
  context.lineWidth = highlighter.size;
  context.globalCompositeOperation = 'source-over';
  context.strokeStyle = hover ? '#3AB1FE' : highlighter.color;

  // move to the first point
  context.moveTo(points[0].x, points[0].y);

  let i = 0;
  for (i = 1; i < points.length - 2; i++) {
    var xc = (points[i].x + points[i + 1].x) / 2;
    var yc = (points[i].y + points[i + 1].y) / 2;
    context.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }

  // curve through the last two points
  context.quadraticCurveTo(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);

  context.stroke();
  context.globalAlpha = 1;
}

export function onStrokeMouseDown(x: number, y: number, toolOption: ToolOption, toolType: string) {
  if (toolType === Tool.Highlighter) {
    highlighter = {
      color: toolOption.highlighterColor,
      size: toolOption.highlighterSize,
      points: [{ x, y }],
    };

    return [highlighter];
  } else {
    stroke = {
      color: toolOption.strokeColor,
      size: toolOption.strokeSize,
      points: [{ x, y }],
    };
    return [stroke];
  }
}

export function onStrokeMouseMove(x: number, y: number, context: CanvasRenderingContext2D, toolType: string) {
  if (!stroke && !highlighter) return [];

  if (toolType === Tool.Stroke || toolType === Tool.Eraser) {
    const newPoint = { x, y };
    const start = stroke.points.slice(-1)[0];
    drawLineStroke(context, stroke, start, newPoint);
    stroke.points.push(newPoint);
    points.push(newPoint);
    return [stroke];
  } else {
    const newPoint = { x, y };
    const start = highlighter.points.slice(-1)[0];
    drawLineHighlighter(context, highlighter, start, newPoint);
    highlighter.points.push(newPoint);
    points.push(newPoint);
    return [highlighter];
  }
}

export function onStrokeMouseUp(setCurrentTool: (tool: Tool) => void, handleCompleteOperation: (tool?: Tool, data?: Stroke, pos?: Position) => void , currentTool = Tool.Stroke) {
  if (!stroke && !highlighter) {
    return;
  };

  // click to back to select mode.
  if (stroke?.points.length < 6 || highlighter?.points.length < 6) {
    if (!isMobileDevice) {
      setCurrentTool(Tool.Select);
    }

    handleCompleteOperation();

    points = [];
    stroke = null;
    highlighter = null;

    return;
  }

  const item = currentTool === Tool.Stroke || currentTool === Tool.Eraser ? stroke : highlighter;
  points = [];
  stroke = null;
  highlighter = null;

  if (item) {
    let lineData = item;
    let pos = null;

    let xMax = -Infinity, yMax = -Infinity, xMin = lineData.points[0].x, yMin = lineData.points[0].y;

    lineData.points.forEach((p) => {
      if (p.x > xMax) {
        xMax = p.x;
      }
      if (p.x < xMin) {
        xMin = p.x;
      }
      if (p.y > yMax) {
        yMax = p.y;
      }
      if (p.y < yMin) {
        yMin = p.y;
      }
    });

    pos = {
      x: xMin,
      y: yMin,
      w: xMax - xMin,
      h: yMax - yMin,
    };

    handleCompleteOperation(currentTool, lineData, pos);
  }

  return [item];
}

export const useStrokeDropdown = (currentToolOption: ToolOption, setCurrentToolOption: (option: ToolOption) => void, setCurrentTool: (tool: Tool) => void, prefixCls: string, toolType: string) => {
  prefixCls += '-strokeTool';

  return (
    <div className={`${prefixCls}-strokeMenu`}>
      <div className={`${prefixCls}-colorAndSize`}>
        <div className={toolType === Tool.Stroke ? `${prefixCls}-strokeSelector-circle` : `${prefixCls}-strokeSelector-square`}>
          {toolType === Tool.Stroke && strokeSize.map(size => {
            return (
              <div
                key={size}
                onClick={(evt) => {
                  evt.stopPropagation();
                  setCurrentToolOption({ ...currentToolOption, strokeSize: size });
                  setCurrentTool && setCurrentTool(Tool.Stroke);
                }}
                onTouchStart={(evt) => {
                  evt.stopPropagation();
                  setCurrentToolOption({ ...currentToolOption, strokeSize: size });
                  setCurrentTool && setCurrentTool(Tool.Stroke);
                }}
                style={{ width: size + 4, height: size + 4, background: size === currentToolOption.strokeSize ? '#666666' : '#EEEEEE' }}
              ></div>
            )
          })}
          {toolType === Tool.Highlighter && strokeSize.map(size => {
            return (
              <div
                key={size}
                onClick={(evt) => {
                  evt.stopPropagation();
                  setCurrentToolOption({ ...currentToolOption, highlighterSize: size });
                  setCurrentTool && setCurrentTool(Tool.Highlighter);
                }}
                onTouchStart={(evt) => {
                  evt.stopPropagation();
                  setCurrentToolOption({ ...currentToolOption, highlighterSize: size });
                  setCurrentTool && setCurrentTool(Tool.Highlighter);
                }}
                style={{ width: size + 4, height: size + 4, background: size === currentToolOption.highlighterSize ? '#666666' : '#EEEEEE' }}
              ></div>
            )
          })}
        </div>
        <div className={`${prefixCls}-split`}></div>
        <div className={`${prefixCls}-palette`}>
          {toolType === Tool.Stroke && strokeColor.map(color => {
            return (
              <div
                className={`${prefixCls}-color`}
                key={color}
                onClick={(evt) => {
                  evt.stopPropagation();
                  setCurrentToolOption({ ...currentToolOption, strokeColor: color });
                  setCurrentTool && setCurrentTool(Tool.Stroke);
                }}
                onTouchStart={(evt) => {
                  evt.stopPropagation();
                  setCurrentToolOption({ ...currentToolOption, strokeColor: color });
                  setCurrentTool && setCurrentTool(Tool.Stroke);
                }}
              >
                <div className={`${prefixCls}-fill`} style={{ background: color }}></div>
                {currentToolOption.strokeColor === color ? <Icon type="check" style={color === '#ffffff' ? { color: '#979797' } : {}} /> : null}
              </div>
            );
          })}
          {toolType === Tool.Highlighter && strokeColor.map(color => {
            return (
              <div
                className={`${prefixCls}-color`}
                key={color}
                onClick={(evt) => {
                  evt.stopPropagation();
                  setCurrentToolOption({ ...currentToolOption, highlighterColor: color });
                  setCurrentTool && setCurrentTool(Tool.Highlighter);
                }}
                onTouchStart={(evt) => {
                  evt.stopPropagation();
                  setCurrentToolOption({ ...currentToolOption, highlighterColor: color });
                  setCurrentTool && setCurrentTool(Tool.Highlighter);
                }}
              >
                <div className={`${prefixCls}-fill`} style={{ background: color }}></div>
                {currentToolOption.highlighterColor === color ? <Icon type="check" style={color === '#ffffff' ? { color: '#979797' } : {}} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  )
}

export const moveStroke = (prev: Stroke, oldPos: Position, newPos: Position) => {
  const diffX = newPos.x - oldPos.x;
  const diffY = newPos.y - oldPos.y;

  return prev.points.map(p => ({
    x: p.x + diffX,
    y: p.y + diffY,
  }));
}

export const moveHighlighter = (prev: Highlighter, oldPos: Position, newPos: Position) => {
  const diffX = newPos.x - oldPos.x;
  const diffY = newPos.y - oldPos.y;

  return prev.points.map(p => ({
    x: p.x + diffX,
    y: p.y + diffY,
  }));
}