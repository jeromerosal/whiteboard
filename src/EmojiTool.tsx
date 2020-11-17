import React, { useState } from 'react';
import ReactDOMServer from 'react-dom/server';
import Tool, { ToolOption, EmojiOption, Position, EmojiSize, strokeColor } from './enums/Tool';
import { IntlShape, } from 'react-intl';
import { RefObject, MouseEvent as ReactMouseEvent } from 'react';
import { mapClientToCanvas, isMobileDevice } from './utils';
import { Icon, Slider } from 'antd';
import './TextTool.less';
import html2canvas from 'html2canvas';
import './images/fb-icons.png';

let currentText = '';
let currentColor = '';
let currentSize = EmojiSize.Default;

const emojiSize = [EmojiSize.Small, EmojiSize.Default, EmojiSize.Large, EmojiSize.XL, EmojiSize.XXL];

export interface Emoji {
  size: EmojiSize,
  color: string,
  text: string,
}

export const onEmojiMouseDown = (e, toolOption, scale:number , refInput, refCanvas, intl, selectedItem, setCurrentTool: (tool: Tool) => void) => {
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
    textarea.innerText = '';

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
    }, 200);

    currentText = typeof toolOption.defaultEmoji === 'string' ? toolOption.defaultText : intl.formatMessage(toolOption.defaultEmoji);
    currentColor = toolOption.textColor;
    currentSize = toolOption.emojiSize;
  }
}

export const onEmojiComplete = async (refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool, setShowEmojiMenu) => {
  if (refInput.current && refCanvas.current) {
    const textarea = refInput.current;
    textarea.style.opacity = '0';

    const imgForCanvas = await document.getElementById('emojiId');

      try {
        let result = await html2canvas(imgForCanvas);

        const image = new Image();
        image.onload = () => {
          textarea.style.opacity = '1';
  
          const currentPos = mapClientToCanvas({
            clientX: 200,
            clientY: 200,
          } as ReactMouseEvent<HTMLCanvasElement>, refCanvas.current, viewMatrix);
  
          textarea.style.display = 'none';
  
          const pos: any = {
            x: currentPos[0],
            y: currentPos[1],
            w: 100,
            h: 120,
          };
      
          handleCompleteOperation(Tool.Image, {
            imageData: result.toDataURL(),
          }, pos);
        }
        image.src = result.toDataURL();
        setShowEmojiMenu(false);

    } catch (e) {
      console.error(e);
    }
    
    setCurrentTool(Tool.Select);
    currentText = '';
  }
}

export const fontEmoji = `"PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, "Hiragino Sans GB", "Microsoft YaHei", SimSun, sans-serif, "localant"`;

export const drawEmoji = (item: Emoji, context: CanvasRenderingContext2D, pos: Position) => {
  context.globalCompositeOperation = 'source-over';
  context.font = `${item.size}px ${fontEmoji}` ;
  context.fillStyle = item.color || '#4a4a4a';
  context.textBaseline = 'middle';

  const lines = item.text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    context.fillText(lines[i], pos.x, pos.y + item.size / 2 + (i * item.size)); // add half line height cause to textBaseline middle
  }
}

export const useEmojiDropdown = (currentToolOption: ToolOption, setCurrentToolOption: (option: ToolOption) => void, setCurrentTool: (tool: Tool) => void, intl: IntlShape, prefixCls: string) => {
  prefixCls += '-textTool';

  const handleSizes = (value) => {
    setCurrentToolOption({ ...currentToolOption, emojiSize: value });
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
            value={ currentToolOption.emojiSize === currentSize? currentSize : currentToolOption.emojiSize}
            onChange = {handleSizes}
          />
        </div>
      </div>
    </div>
  )
}