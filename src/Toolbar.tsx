import React, { useRef, useState, ChangeEventHandler, useContext, useEffect } from 'react';
import { useSpring, animated } from 'react-spring';
import { useIntl } from 'react-intl';
import './Toolbar.less';
import Tool, { ToolOption } from './enums/Tool';
import ClearIcon from './svgs/ClearIcon';
import HighlighterIcon from './svgs/HighlighterIcon';
import ImageIcon from './svgs/ImageIcon';
import RedoIcon from './svgs/RedoIcon';
import SaveIcon from './svgs/SaveIcon';
import SelectIcon from './svgs/SelectIcon';
import ShapeIcon from './svgs/ShapeIcon';
import StrokeIcon from './svgs/StrokeIcon';
import TextIcon from './svgs/TextIcon';
import LatexIcon from './svgs/LatexIcon';
import GridIcon from './svgs/GridIcon';
import EmojiIcon from './svgs/EmojiIcon';
import FormulaIcon from './svgs/FormulaIcon';
import UndoIcon from './svgs/UndoIcon';
import ZoomIcon from './svgs/ZoomIcon';
import EraserIcon from './svgs/EraserIcon';
import { useStrokeDropdown } from './StrokeTool';
import { useShapeDropdown } from './ShapeTool';
import { Dropdown, Slider } from 'antd';
import classNames from 'classnames';
import './Toolbar.less';
import { isMobileDevice } from './utils';
import ConfigContext from './ConfigContext';
import EnableSketchPadContext from './contexts/EnableSketchPadContext';

const tools = [{
  label: 'umi.block.sketch.select',
  icon: SelectIcon,
  type: Tool.Select,
}, 
{
  label: 'umi.block.sketch.pencil',
  icon: StrokeIcon,
  type: Tool.Stroke,
  useDropdown: useStrokeDropdown,
}, 
{
  label: 'umi.block.sketch.highlighter',
  icon: HighlighterIcon,
  type: Tool.Highlighter,
  useDropdown: useStrokeDropdown,
},
{
  label: 'umi.block.sketch.shape',
  icon: ShapeIcon,
  type: Tool.Shape,
  useDropdown: useShapeDropdown,
},
{
  label: 'umi.block.sketch.eraser',
  icon: EraserIcon,
  type: Tool.Eraser,
},
{
  label: 'umi.block.sketch.text',
  icon: TextIcon,
  type: Tool.Text,
}, 
{
  label: 'umi.block.sketch.emoji',
  icon: EmojiIcon,
  type: Tool.Emoji,
},
{
  label: 'umi.block.sketch.latex',
  icon: LatexIcon,
  type: Tool.Latex,
},
{
  //label: 'umi.block.sketch.image',
  label: 'umi.block.sketch.file',
  icon: ImageIcon,
  type: Tool.Image,
},
{
  label: 'umi.block.sketch.grid',
  icon: GridIcon,
  type: Tool.Grid,
},
{
  label: 'umi.block.sketch.undo',
  icon: UndoIcon,
  type: Tool.Undo,
  style: {
    marginLeft: 'auto',
  },
}, 
{
  label: 'umi.block.sketch.redo',
  icon: RedoIcon,
  type: Tool.Redo,
}, 
{
  label: 'umi.block.sketch.clear',
  icon: ClearIcon,
  type: Tool.Clear,
  style: {
    marginRight: 'auto',
  },
}, ...(!isMobileDevice ? [{
  label: '100%',
  labelThunk: (props: ToolbarProps) => `${~~(props.scale * 100)}%`,
  icon: ZoomIcon,
  type: Tool.Zoom,
}] : []), ...(!isMobileDevice ? [{
  label: 'umi.block.sketch.save',
  icon: SaveIcon,
  type: Tool.Save,
}]: [])];

export interface ToolbarProps {
  currentTool: Tool;
  setCurrentTool: (tool: Tool) => void;
  currentToolOption: ToolOption;
  setCurrentToolOption: (option: ToolOption) => void;
  selectImage: (image: string) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  save: () => void;
  scale: number;
  toolbarPlacement: string;
  showEraserSize: any;
  setShowEraserSize: any;
  setEraserSize: any;
  eraserSize: number;
  setShowGrid: any;
  showGrid: boolean;
}

const Toolbar: React.FC<ToolbarProps> = (props) => {
  const { currentTool, setCurrentTool, currentToolOption, setCurrentToolOption, selectImage, undo, redo, clear, save, toolbarPlacement, setShowEraserSize, setEraserSize, showEraserSize, eraserSize, setShowGrid, showGrid } = props;
  const refFileInput = useRef<HTMLInputElement>(null);
  const { formatMessage } = useIntl();
  const { prefixCls } = useContext(ConfigContext);
  const enableSketchPadContext = useContext(EnableSketchPadContext);
  const [ displayToolTip, setDisplayToolTip ] = useState(false);

  const toolbarPrefixCls = prefixCls + '-toolbar';

  const handleFileChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files && e.target.files[0];

    if (file) {
      let reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = () => {
        const base64data = reader.result;
        selectImage(base64data as string);
      }
    }
  };

  useEffect(() => {
    const keydownHandler = (evt: KeyboardEvent) => {
      const { keyCode } = evt;
      
      if ( keyCode == 90 && evt.ctrlKey) { // key 'ctrl+z'
        undo();
      }
      else if( keyCode == 89 && evt.ctrlKey) { // key 'ctrl+y'
        redo();
      }
    };

    addEventListener('keydown', keydownHandler);

    return () => removeEventListener('keydown', keydownHandler);
  }, []);

  //handleEraserSize
  const handleEraserSize = (value) => {
    setEraserSize(value)
  }

  return (
    <div className={classNames({
      [`${toolbarPrefixCls}-container`]: true,
      [`${toolbarPrefixCls}-mobile-container`]: isMobileDevice,
    })}>
      {tools.map((tool => {
        let borderTopStyle = 'none';
        if (isMobileDevice) {
          if ((tool.type === Tool.Stroke || tool.type === Tool.Highlighter) && currentToolOption.strokeColor) {
            borderTopStyle = `3px solid ${currentToolOption.strokeColor}`;
          }

          if (tool.type === Tool.Shape && currentToolOption.shapeBorderColor) {
            borderTopStyle = `3px solid ${currentToolOption.shapeBorderColor}`;
          }

          if (tool.type === Tool.Text){
          }

          if (tool.type === Tool.Latex){
          }

          if (tool.type === Tool.Emoji){
          }
          if (tool.type === Tool.Formula){
          }
        }

        const iconAnimateProps = useSpring({
          left: isMobileDevice && currentTool !== tool.type ? -12 : 0,
          position: 'relative',
          borderTop: borderTopStyle,
          ...(tool.style || {})
        });

        const menu = (
          <animated.div
            className={classNames({
              [`${toolbarPrefixCls}-icon`]: true,
              [`${tool.labelThunk ? tool.labelThunk(props) : formatMessage({ id: tool.label })}-icon`]: true,
              [`${toolbarPrefixCls}-activeIcon`]: currentTool === tool.type && !isMobileDevice,
              [`${toolbarPrefixCls}-mobile-icon`]: isMobileDevice,
            })}
            style={iconAnimateProps}
            onClick={() => {
              let currentToolType = tool.type;
              if (tool.type === Tool.Image && refFileInput.current) {
                setShowEraserSize(false);
                refFileInput.current.click();
              } else if (tool.type === Tool.Undo) {
                setShowEraserSize(false);
                undo();
                currentToolType = tool.type;
              } else if (tool.type === Tool.Eraser) { 
                setShowEraserSize(true);
                setCurrentTool(tool.type);
              } else if (tool.type === Tool.Redo) {
                setShowEraserSize(false);
                redo();
                currentToolType = tool.type;
              } else if (tool.type === Tool.Clear) {
                setShowEraserSize(false);
                clear();
                currentToolType = tool.type;
              } else if (tool.type === Tool.Grid) {
                setShowGrid(!showGrid);
                currentToolType = tool.type;
              }
              else if (tool.type === Tool.Zoom) {
                setShowEraserSize(false);
              } else if (tool.type === Tool.Save) {
                setShowEraserSize(false);
                save();
              } else {
                setCurrentTool(currentToolType);
                setShowEraserSize(false);
              }
            }}
            key={tool.label}
          >
            <tool.icon />
            <span className={'toolbar-tooltip'} style={{position: 'absolute',top: -10, left: 'calc(100% - 10px)', background: '#ffffff', border: '1px solid #dedede', borderRadius: 4, padding: 3}}>
              {!isMobileDevice ? <label style={{color: 'rgb(24, 144, 255)'}} className={`${toolbarPrefixCls}-iconLabel`}>{tool.labelThunk ? tool.labelThunk(props) : formatMessage({ id: tool.label })}</label> : null}
            </span>
            <span>
            {tool.labelThunk || formatMessage({ id: tool.label }) && formatMessage({ id: tool.label }).indexOf('0') > -1 ? <span style={{color: 'rgb(24, 144, 255)'}}>{tool.labelThunk ? tool.labelThunk(props) : formatMessage({ id: tool.label })}</span> : null}
            </span>
            {tool.type === Tool.Eraser &&
              <div style={{
                position: 'absolute',
                top: '0',
                left: 'calc(100% + 5px)',
                height: 'auto',
                width: 'auto',
                border: '1px solid rgb(218, 218, 218)',
                borderRadius: '5px',
                padding: 10,
                alignItems: 'center',
                justifyContent: 'space-between',
                display: showEraserSize? 'flex': 'none',
                color: '#83bff7',
                flexDirection: 'column',
                background: '#ffffff'
              }}>
                <label>Select Size:</label>
                <Slider 
                  className={'eraser-size'}
                  value={eraserSize}
                  min={1}
                  max={50}
                  style={{width: 75}}
                  onChange={handleEraserSize}
                />
                <span className="eraser-size-circle">
                  <label>
                    Eraser Size Preview
                  </label>
                  <span
                    style={{
                      width: eraserSize,
                      height: eraserSize, 
                      borderRadius: '50%',
                      background: '#ffffff',
                      border: '1px solid #91d5ff'
                    }}
                  ></span>
                </span>
              </div>
            }
          </animated.div>
        )

        if (tool.useDropdown) {
          const overlay = tool.useDropdown(currentToolOption, setCurrentToolOption, setCurrentTool, prefixCls, tool.type);

          return (
            <div key={tool.label}>
              <Dropdown
                overlay={overlay}
                placement={toolbarPlacement === 'top' || toolbarPlacement === 'left' ? 'bottomLeft' : 'bottomRight'}
                trigger={[isMobileDevice ? 'click' : 'hover']}
                onVisibleChange={(visible) => {
                  enableSketchPadContext.setEnable(!visible);
                }}
              >
                {menu}
              </Dropdown>
            </div>
          )
        } else {
          return menu;
        }
      }))}

      <input
        type="file"
        style={{ display: 'none' }}
        accept="image/jpeg, image/png, video/mp4, video/avi, application/pdf"
        ref={refFileInput}
        onChange={handleFileChange}
      />
    </div>
  )
} 

export default Toolbar;