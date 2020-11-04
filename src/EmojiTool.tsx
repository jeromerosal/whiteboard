import React, { useState } from 'react';
import ReactDOMServer from 'react-dom/server';
import Tool, { ToolOption, EmojiOption, Position, EmojiSize, strokeColor } from './enums/Tool';
import { IntlShape, } from 'react-intl';
import { RefObject, MouseEvent as ReactMouseEvent } from 'react';
import { mapClientToCanvas, isMobileDevice } from './utils';
import { Icon, Slider } from 'antd';
import './TextTool.less';
import html2canvas from 'html2canvas';

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
    textarea.style.fontSize = (toolOption.emojiSize as number) * scale + 'px';
    textarea.style.lineHeight = (toolOption.emojiSize as number) * scale + 'px';
    textarea.style.height = (toolOption.emojiSize as number) * scale + 'px';
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
    currentSize = toolOption.emojiSize;
  }
}

export const onEmojiComplete = (refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool) => {
  if (currentText && refInput.current && refCanvas.current) {
    const textarea = refInput.current;
    textarea.style.opacity = '0';
    const text = textarea.innerText;

    const imgForCanvas = document.getElementById('emojiId');
    const _imgs = imgForCanvas.firstChild.firstChild.style;
    let _backgroundImage = _imgs.backgroundImage;
    _backgroundImage = _backgroundImage.replace('url("', '');
    _backgroundImage = _backgroundImage.replace('")','');
    let _backgroundPosX = _imgs.backgroundPositionX.replace('%','');
    _backgroundPosX = ( _backgroundPosX -50 ) * -1;
    let _backgroundPosY = _imgs.backgroundPositionY.replace('%','');
    _backgroundPosY = ( _backgroundPosY -50 ) * -1;

    let htmlToCanvas = document.createElement('div');
    htmlToCanvas.setAttribute('style', `position: fixed; z-index: 999; width: 100px;height: 100px;border: 1px solid black;right: 0; top: 0;`)

    const emojiImg = <img 
          src={_backgroundImage}
          style={{
            position: 'absolute',
            top: 50,
            left: 0,
            width: 100,
            height: 100,
            display: 'flex',
            transform: `scale(57) translateX(${_backgroundPosX}px) translateY(${_backgroundPosY}px)`
          }}
        />;

    const htmlCanvasContent = ReactDOMServer.renderToStaticMarkup(emojiImg); 
    htmlToCanvas.innerHTML = htmlCanvasContent;

    document.body.appendChild(htmlToCanvas);

    html2canvas(htmlToCanvas, {
      allowTaint: false,
      logging:true
    }).then(_canvas => {
      //htmlToCanvas.setAttribute('style', 'visibility:hidden;');
      const width = htmlToCanvas.offsetWidth;
      const height = htmlToCanvas.offsetHeight;
      
      //htmlToCanvas.remove();

      const image = new Image();
      image.onload = () => {
        textarea.style.opacity = '1';
        let { top, left } = textarea.getBoundingClientRect();

        const currentPos = mapClientToCanvas({
          clientX: left,
          clientY: top,
        } as ReactMouseEvent<HTMLCanvasElement>, refCanvas.current, viewMatrix);

        textarea.style.display = 'none';

        const pos: any = {
          x: currentPos[0],
          y: currentPos[1],
          w: width/1.45,
          h: height/1.7,
        };
    
        handleCompleteOperation(Tool.Image, {
          imageData: _canvas.toDataURL(),
        }, pos);
      }

      image.src = _canvas.toDataURL();
    });
    setCurrentTool(Tool.Select);
    currentText = '';
  }
}

export const onEmojiCompletesss = (refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool) => {
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

    handleCompleteOperation(Tool.Emoji, { text, color: currentColor, size: currentSize }, pos);
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