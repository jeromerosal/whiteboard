import React, { useState } from 'react';
import Tool, { ToolOption, LatexOption, Position, LatexSize, strokeColor } from './enums/Tool';
import ReactDOMServer from 'react-dom/server';
import { IntlShape, } from 'react-intl';
import { RefObject, MouseEvent as ReactMouseEvent } from 'react';
import { BlockMath } from "react-katex";
import { mapClientToCanvas, isMobileDevice } from './utils';
import html2canvas from 'html2canvas';
import { Icon } from 'antd';
import './TextTool.less';

let currentText = '';
let currentColor = '';
let currentSize = LatexSize.Default;

const latexSize = [LatexSize.Small, LatexSize.Default, LatexSize.Large, LatexSize.XL, LatexSize.XXL];

export interface Latex {
  size: LatexSize,
  color: string,
  text: string,
}

export const onLatexMouseDown = (e, toolOption, scale:number , refInput, refCanvas, intl, selectedItem, setCurrentTool: (tool: Tool) => void) => {
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
    textarea.style.fontSize = (toolOption.latexSize as number) * scale + 'px';
    textarea.style.lineHeight = (toolOption.latexSize as number) * scale + 'px';
    textarea.style.height = (toolOption.latexSize as number) * scale + 'px';
    textarea.style.color = toolOption.textColor;
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

    currentText = typeof toolOption.defaultText === 'string' ? toolOption.defaultText : intl.formatMessage(toolOption.defaultText);
    currentColor = toolOption.textColor;
    currentSize = toolOption.latexSize;
  }
}

export const onLatexComplete = (refInput, refCanvas, viewMatrix, scale, handleCompleteOperation, setCurrentTool, latexFontSize, latexFontColor, setErrorMessageAs) => {
  if (currentText && refInput.current && refCanvas.current) {
    const textarea = refInput.current;
    textarea.style.opacity = '0';
    const text = textarea.innerText;
    let htmlToCanvas = document.createElement('div');
    htmlToCanvas.setAttribute('style', 'z-index: 0; opacity: 0;position:fixed;top:100px;left:-100%;');
    htmlToCanvas.setAttribute('id','htmltocanvas');
    let _blockMath = <div style={{color: latexFontColor, fontSize: latexFontSize? latexFontSize * 4 : 30, padding: 0}}>{text}</div>;
    try {
      _blockMath = <div style={{color: latexFontColor, fontSize: latexFontSize? latexFontSize * 4 : 30, padding: 0}}><BlockMath>{`${text}`}</BlockMath></div>;
    }
    catch(e){
      _blockMath = <div style={{color: latexFontColor, fontSize: latexFontSize? latexFontSize * 4 : 30, padding: 0}}>{text}</div>;
    }

    const htmlCanvasContent = ReactDOMServer.renderToStaticMarkup(_blockMath); 
    htmlToCanvas.innerHTML = htmlCanvasContent;
    document.body.appendChild(htmlToCanvas);

    let svgElements: any = document.body.querySelectorAll('svg');
    svgElements.forEach(function(item) {
        item.setAttribute("width", item.getBoundingClientRect().width);
        item.setAttribute("height", item.getBoundingClientRect().height);
        item.style.width = null;
        item.style.height= null;
    });

    if(htmlToCanvas.querySelectorAll('.mord.accent').length) {
      htmlToCanvas.querySelectorAll('.mord.accent').forEach( mord_accent => {
        var _svg = mord_accent.querySelectorAll('svg');
        _svg.forEach( _svgItem => {
          mord_accent.appendChild(_svgItem);
        })
      })
    }

    if(htmlToCanvas.querySelectorAll('.katex-display').length){
      html2canvas(htmlToCanvas.querySelector('.katex-display')).then(_canvas => {
        //htmlToCanvas.setAttribute('style', 'visibility:hidden;');
        let katex_offsetWidth : any = document.querySelectorAll('.katex-html')[0];
        const width = htmlToCanvas.querySelector('.base').offsetWidth;
        const height = htmlToCanvas.querySelector('.katex').offsetHeight;
        
        document.getElementById('htmltocanvas').remove();

        const image = new Image();
        image.onload = () => {
          textarea.style.opacity = '1';
          let { top, left } = textarea.getBoundingClientRect();
          const lineHeight = parseInt(textarea.style.lineHeight.replace('px', ''));

          const currentPos = mapClientToCanvas({
            clientX: left,
            clientY: top,
          } as ReactMouseEvent<HTMLCanvasElement>, refCanvas.current, viewMatrix);

          textarea.style.display = 'none';

          const pos: any = {
            x: currentPos[0],
            y: currentPos[1],
            w: width/1.45,
            h: htmlToCanvas.querySelector('.base').querySelectorAll('*').length < 2
            ? height/2 : height/1.7,
          };
      
          handleCompleteOperation(Tool.Image, {
            imageData: _canvas.toDataURL(),
          }, pos);
        }

        image.src = _canvas.toDataURL();
      });
    }
    else {
      setErrorMessageAs('Unrecognized Formula. Check your format');
      document.getElementById('htmltocanvas').remove();
    }
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

export const useLatexDropdown = (currentToolOption, setCurrentToolOption, setCurrentTool, intl, prefixCls) => {
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
                  setCurrentTool && setCurrentTool(Tool.Latex);
                }}
                onClick={(evt) => {
                  evt.stopPropagation();
                  setCurrentToolOption({ ...currentToolOption, latexSize: size });
                  setCurrentTool && setCurrentTool(Tool.Latex);
                }}
                style={{ color: size === currentToolOption.latexSize ? '#666' : '#ccc' }}
              >
                {size === LatexSize.Small ? intl.formatMessage({ id: 'umi.block.sketch.latex.size.small' }) 
                : size === LatexSize.Default ? intl.formatMessage({ id: 'umi.block.sketch.latex.size.default' }) 
                : size === LatexSize.Large ? intl.formatMessage({ id: 'umi.block.sketch.latex.size.large' }) 
                : size === LatexSize.XL ? intl.formatMessage({ id: 'umi.block.sketch.latex.size.xl' }) 
                : intl.formatMessage({ id: 'umi.block.sketch.latex.size.xxl' })
                }
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}