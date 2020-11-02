import React, { useState } from 'react';
import Tool, { ToolOption, FormulaOption, Position, FormulaSize, strokeColor } from './enums/Tool';
import { IntlShape, } from 'react-intl';
import { RefObject, MouseEvent as ReactMouseEvent } from 'react';
import { mapClientToCanvas, isMobileDevice } from './utils';
import { Icon, Slider } from 'antd';
import './TextTool.less';

let currentText = '';
let currentColor = '';
let currentSize = FormulaSize.Default;

const formulaSize = [FormulaSize.Small, FormulaSize.Default, FormulaSize.Large, FormulaSize.XL, FormulaSize.XXL];

export interface Formula {
  size: FormulaSize,
  color: string,
  text: string,
}

export const onFormulaMouseDown = (e, toolOption, scale:number , refInput, refCanvas, intl, selectedItem, setCurrentTool: (tool: Tool) => void) => {
  setCurrentTool(selectedItem)
  if (!currentText && refInput.current && refCanvas.current) {
    const textarea = refInput.current;
    const canvas = refCanvas.current;

    const { top, left } = canvas.getBoundingClientRect();

    let x = e.clientX - left;
    let y = e.clientY - top;

    textarea.style.display = 'block';
    textarea.style.left = x + canvas.offsetLeft + 'px';
    textarea.style.top = y + canvas.offsetTop + 'px';
    textarea.style.fontSize = (toolOption.formulaSize as number) * scale + 'px';
    textarea.style.lineHeight = (toolOption.formulaSize as number) * scale + 'px';
    textarea.style.height = (toolOption.formulaSize as number) * scale + 'px';
    textarea.style.color = toolOption.textColor;
    textarea.innerText = typeof toolOption.defaultText === 'string' ? toolOption.defaultText : intl.formatMessage(toolOption.defaultText);

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

    currentText = typeof toolOption.defaultText === 'string' ? toolOption.defaultText : intl.formatMessage(toolOption.defaultText);
    currentColor = toolOption.textColor;
    currentSize = toolOption.formulaSize;
  }
}

export const onFormulaComplete = (refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool) => {
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

    handleCompleteOperation(Tool.Formula, { text, color: currentColor, size: currentSize }, pos);
    setCurrentTool(Tool.Select);
    currentText = '';
  }
}

export const fontFormula = `"PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, "Hiragino Sans GB", "Microsoft YaHei", SimSun, sans-serif, "localant"`;

export const drawFormula = (item: Formula, context: CanvasRenderingContext2D, pos: Position) => {
  context.globalCompositeOperation = 'source-over';
  context.font = `${item.size}px ${fontFormula}` ;
  context.fillStyle = item.color || '#4a4a4a';
  context.textBaseline = 'middle';

  const lines = item.text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    context.fillText(lines[i], pos.x, pos.y + item.size / 2 + (i * item.size)); // add half line height cause to textBaseline middle
  }
}

export const useFormulaDropdown = (currentToolOption, setCurrentToolOption, setCurrentTool, intl, prefixCls) => {  
  prefixCls += '-textTool';
  const handleSizes = (value) => {
    setCurrentToolOption({ ...currentToolOption, formulaSize: value });
    setCurrentTool && setCurrentTool(Tool.Formula);
  }
  return (
    <div className={`${prefixCls}-strokeMenu`}>
      <div className={`${prefixCls}-colorAndSize`} style={{display:'flex',flexDirection: 'column'}}>
        <div style={{display: 'flex', flexDirection: 'column', height: 50, justifyContent: 'space-between'}} className={`${prefixCls}-textSizeSelector`}>
          <label>Select Size:</label>
          <Slider 
            key={'sliderMenu'}
            min={12}
            max={300}
            style={{width: 200}}
            value={ currentToolOption.formulaSize === currentSize? currentSize : currentToolOption.formulaSize}
            onChange = {handleSizes}
          />
        </div>
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