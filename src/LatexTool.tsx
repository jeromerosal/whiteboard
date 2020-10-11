import React, { useState } from 'react';
import Tool, { ToolOption, Position, LatexSize, strokeColor } from './enums/Tool';
import { IntlShape, } from 'react-intl';
import { RefObject, MouseEvent as ReactMouseEvent } from 'react';
import { mapClientToCanvas, isMobileDevice } from './utils';
import { Icon } from 'antd';
import './TextTool.less';

let currentText = '';
let currentColor = '';
let currentSize = LatexSize.Default;

const latexSize = [LatexSize.Small, LatexSize.Default, LatexSize.Large, LatexSize.XL];

export interface Latex {
  size: LatexSize,
  color: string,
  text: string,
}

export const onLatexMouseDown = (e: {
  clientX: number,
  clientY: number,
}, toolOption: ToolOption, scale: number, refInput: RefObject<HTMLDivElement>, refCanvas: RefObject<HTMLCanvasElement>, intl: IntlShape) => {
  if (!currentText && refInput.current && refCanvas.current) {
    const textarea = refInput.current;
    const canvas = refCanvas.current;

    const { top, left } = canvas.getBoundingClientRect();

    let x = e.clientX - left;
    let y = e.clientY - top;

    textarea.style.display = 'block';
    textarea.style.left = x + canvas.offsetLeft + 'px';
    textarea.style.top = y + canvas.offsetTop + 'px';
    textarea.style.fontSize = (toolOption.latexSize as number) * scale + 'px';
    textarea.style.lineHeight = (toolOption.latexSize as number) * scale + 'px';
    textarea.style.height = (toolOption.latexSize as number) * scale + 'px';
    textarea.style.color = toolOption.textColor;
    textarea.innerText = typeof toolOption.defaultLatex === 'string' ? toolOption.defaultLatex : intl.formatMessage(toolOption.defaultLatex);

    if (isMobileDevice) {
      textarea.focus();
    }

    setTimeout(() => {
      if (getSelection && Range) {
        const selection = getSelection();

        if (selection) {
          selection.removeAllRanges();
          var range = new Range();
          range.selectNodeContents(textarea);
          selection.addRange(range);
        }
      }
    }, 0);

    currentText = typeof toolOption.defaultLatex === 'string' ? toolOption.defaultLatex : intl.formatMessage(toolOption.defaultLatex);
    currentColor = toolOption.textColor;
    currentSize = toolOption.latexSize;
  }
}

export const onLatexComplete = (refInput: RefObject<HTMLDivElement>, refCanvas: RefObject<HTMLCanvasElement>, viewMatrix: number[], scale: number, handleCompleteOperation: (tool?: Tool, data?: Latex, pos?: Position) => void, setCurrentTool: (tool: Tool) => void) => {
  if (currentText && refInput.current && refCanvas.current) {
    const textarea = refInput.current;
    const text = textarea.innerText;
    let { top, left, width, height } = textarea.getBoundingClientRect();
    width = 1 / scale * width;
    const lineHeight = parseInt(textarea.style.lineHeight.replace('px', ''));
    height = 1 / scale * lineHeight * text.split('\n').length;

    const currentPos = mapClientToCanvas({
      clientX: left,
      clientY: top,
    } as ReactMouseEvent<HTMLCanvasElement>, refCanvas.current, viewMatrix);

    textarea.style.display = 'none';

    const pos: Position = {
      x: currentPos[0],
      y: currentPos[1],
      w: width,
      h: height,
    };

    handleCompleteOperation(Tool.Latex, { text, color: currentColor, size: currentSize }, pos);
    setCurrentTool(Tool.Select);
    currentText = '';
  }
}

export const fontLatex = `"PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, "Hiragino Sans GB", "Microsoft YaHei", SimSun, sans-serif, "localant"`;

export const drawLatex = (item: Latex, context: CanvasRenderingContext2D, pos: Position) => {
  context.globalCompositeOperation = 'source-over';
  context.font = `${item.size}px ${fontLatex}` ;
  context.fillStyle = item.color || '#4a4a4a';
  context.textBaseline = 'middle';

  const lines = item.text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    context.fillText(lines[i], pos.x, pos.y + item.size / 2 + (i * item.size)); // add half line height cause to textBaseline middle
  }
}

export const useLatexDropdown = (currentToolOption: ToolOption, setCurrentToolOption: (option: ToolOption) => void, setCurrentTool: (tool: Tool) => void, intl: IntlShape, prefixCls: string) => {
  prefixCls += '-textTool';
  return (
    <div className={`${prefixCls}-strokeMenu`}>
      <div className={`${prefixCls}-colorAndSize`}>
        <div className={`${prefixCls}-textSizeSelector`}>
          {latexSize.map(size => {
            return (
              <div
                key={size}
                onTouchStart={(evt) => {
                  evt.stopPropagation();
                  setCurrentToolOption({ ...currentToolOption, latexSize: size });
                  setCurrentTool && setCurrentTool(Tool.Stroke);
                }}
                onClick={(evt) => {
                  evt.stopPropagation();
                  setCurrentToolOption({ ...currentToolOption, latexSize: size });
                  setCurrentTool && setCurrentTool(Tool.Stroke);
                }}
                style={{ color: size === currentToolOption.latexSize ? '#666' : '#ccc' }}
              >
                {size === LatexSize.Small ? intl.formatMessage({ id: 'umi.block.sketch.latex.size.small' }) 
                : size === LatexSize.Default ? intl.formatMessage({ id: 'umi.block.sketch.latex.size.default' }) 
                : size === LatexSize.Large ? intl.formatMessage({ id: 'umi.block.sketch.latex.size.large' }) 
                : intl.formatMessage({ id: 'umi.block.sketch.latex.size.xl' })
                }
              </div>
            )
          })}
        </div>
        <div className={`${prefixCls}-split`}></div>
        <div className={`${prefixCls}-palette`}>
          {strokeColor.map(color => {
            return <div className={`${prefixCls}-color`} key={color}
              onClick={(evt) => {
                evt.stopPropagation();
                setCurrentToolOption({ ...currentToolOption, textColor: color });
                setCurrentTool && setCurrentTool(Tool.Stroke);
              }}
              onTouchStart={(evt) => {
                evt.stopPropagation();
                setCurrentToolOption({ ...currentToolOption, textColor: color });
                setCurrentTool && setCurrentTool(Tool.Stroke);
              }}
            >
              <div className={`${prefixCls}-fill`} style={{ background: color }}></div>
              {currentToolOption.textColor === color ? <Icon type="check" style={color === '#ffffff' ? { color: '#979797' } : {}} /> : null}
            </div>
          })}
        </div>
      </div>
    </div>
  )
}