import React from 'react';
import Tool, { ToolOption } from './enums/Tool';
import { Icon } from 'antd';
import './FileTool.less';
import ImageIcon from './svgs/files/ImageIcon';
import PdfIcon from './svgs/files/PdfIcon';
import VideoIcon from './svgs/files/VideoIcon';

export const useFileDropDown = (currentToolOption: ToolOption, setCurrentToolOption: (option: ToolOption) => void, setCurrentTool: (tool: Tool) => void, prefixCls: string, toolType: string) => {
  prefixCls += '-fileTool';

  return (
    <div className={`${prefixCls}-fileMenu`}>
      <div className={`${prefixCls}-links`}>
        <div
          onClick={(evt) => {
            evt.stopPropagation();
            setCurrentTool(Tool.Image);
          }}
          onTouchStart={(evt) => {
            evt.stopPropagation();
            setCurrentTool(Tool.Image);
          }}
          className={`${prefixCls}-section`} 
          title={Tool.Image}
        >
          <ImageIcon />
        </div>
        <div
          onClick={(evt) => {
            evt.stopPropagation();
            setCurrentTool(Tool.Video);
          }}
          onTouchStart={(evt) => {
            evt.stopPropagation();
            setCurrentTool(Tool.Video);
          }}
          className={`${prefixCls}-section`} 
          title={Tool.Video}
        >
          <VideoIcon />
        </div>
        <div
          onClick={(evt) => {
            evt.stopPropagation();
            setCurrentTool(Tool.Pdf);
          }}
          onTouchStart={(evt) => {
            evt.stopPropagation();
            setCurrentTool(Tool.Pdf);
          }}
          className={`${prefixCls}-section`} 
          title={Tool.Pdf}
        >
          <PdfIcon />
        </div>
      </div>
    </div>
  )
}