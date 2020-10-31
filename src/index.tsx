import React, { useState, useRef, CSSProperties, useEffect, useReducer, useMemo } from 'react';
import { v4 } from 'uuid';
import { animated, useSpring, } from 'react-spring';
import { IntlProvider } from 'react-intl';
import { Layout } from 'antd';
import Toolbar from './Toolbar';
import SketchPad, { SketchPadRef, Operation, onChangeCallback, onSaveCallback } from './SketchPad';
import Tool, { ToolOption, defaultToolOption, ShapeType } from './enums/Tool';
import EnableSketchPadContext from './contexts/EnableSketchPadContext';
import locales, { localeType } from './locales';
import { isMobileDevice } from './utils';
import './index.less';
import ConfigContext, { DefaultConfig } from './ConfigContext';
import { BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';

const { Header, Sider, Content } = Layout;

interface BlockProps {
  userId?: string;
  locale?: localeType;

  // controlled mode
  operations?: Operation[];
  onChange?: onChangeCallback;
  onSave?: onSaveCallback;

  style?: CSSProperties;

  clsssName?: string;

  toolbarPlacement?: 'top' | 'left' | 'right';
}

const AnimatedSketchPad = animated(SketchPad);

const defaultProps = {
  userId: v4(),
  locale: navigator.language as localeType,
  toolbarPlacement: 'top',
};

const enableSketchPadReducer = (state: boolean, action: boolean) => {
  return action;
}

const Block: React.FC<BlockProps> = (props) => {
  const { userId, operations, onChange, toolbarPlacement, clsssName, onSave } = { ...defaultProps, ...props };

  const [currentTool, setCurrentTool] = useState(Tool.Stroke);
  const [scale, setScale] = useState(1);
  const [currentToolOption, setCurrentToolOption] = useState<ToolOption>(defaultToolOption);
  const enableSketchPad = useReducer(enableSketchPadReducer, true);
  const refSketch = useRef<SketchPadRef>(null);
  const [ showEraserSize, setShowEraserSize] = useState(false);
  const [ eraserSize, setEraserSize ] = useState(2);

  const animatedProps = useSpring<{
    value: number
  }>({ value: scale, });

  useEffect(() => {
    const keydownHandler = (evt: KeyboardEvent) => {
      const { keyCode } = evt;
      if (keyCode === 80) { // key 'p'
        setCurrentTool(Tool.Stroke);
      } else if (keyCode === 82) { // key 'r'
        setCurrentTool(Tool.Shape);
        setCurrentToolOption({ ...currentToolOption, shapeType: ShapeType.Rectangle });
      } else if (keyCode === 79) { // key 'o'
        setCurrentTool(Tool.Shape);
        setCurrentToolOption({ ...currentToolOption, shapeType: ShapeType.Oval });
      } else if (keyCode === 84) { // key 't'
        setCurrentTool(Tool.Text);
      }
    };

    addEventListener('keydown', keydownHandler);

    return () => removeEventListener('keydown', keydownHandler);
  }, []);

  const renderWithLayout = (toolbar: React.ReactElement, sketchPad: React.ReactElement) => {
    if (toolbarPlacement === 'left' || isMobileDevice) {
      return <Layout style={{ flexDirection: 'row' }}>
        <Sider width={isMobileDevice ? 40 : 55} theme='light'>{toolbar}</Sider>
        <Content>{sketchPad}</Content>
      </Layout>
    } else if (toolbarPlacement === 'top') {
      return <Layout hasSider={false}>
        {toolbar}
        <Content>{sketchPad}</Content>
      </Layout>
    } else if (toolbarPlacement === 'right') {
      return <Layout style={{ flexDirection: 'row' }}>
              <Content>{sketchPad}</Content>
              <Sider width={55} theme='light'>{toolbar}</Sider>
            </Layout>
    } else {
      return null;
    }
  };

  const enableSketchPadContextValue = useMemo(() => {
    return {
      enable: enableSketchPad[0],
      setEnable: enableSketchPad[1],
    };
  }, [...enableSketchPad]);

  const locale = props.locale && locales.messages[props.locale] ? props.locale : localeType.enUS;

  return (
    <ConfigContext.Provider value={DefaultConfig}>
      <IntlProvider locale={locale} messages={locales.messages[locale]}>
        <EnableSketchPadContext.Provider value={enableSketchPadContextValue}>
          <ConfigContext.Consumer>
            {config => (
              <div className={`${config.prefixCls}-container ${clsssName || ''}`} style={{ width: '100vw', height: '100vh', ...(props.style || {}) }}>
                {renderWithLayout((
                  <Toolbar
                    toolbarPlacement={toolbarPlacement}
                    currentTool={currentTool}
                    setCurrentTool={setCurrentTool}
                    currentToolOption={currentToolOption}
                    setCurrentToolOption={setCurrentToolOption}
                    scale={scale}
                    eraserSize={eraserSize}
                    selectImage={(image: string) => {
                      if (image && refSketch.current) {
                        refSketch.current.selectImage(image);
                      }
                    }}
                    undo={() => {
                      if (refSketch.current) {
                        refSketch.current.undo();
                      }
                    }}
                    redo={() => {
                      if (refSketch.current) {
                        refSketch.current.redo();
                      }
                    }}
                    clear={() => {
                      if (refSketch.current) {
                        refSketch.current.clear();
                      }
                    }}
                    save={() => {
                      if (refSketch.current) {
                        refSketch.current.save(onSave);
                      }
                    }}
                    showEraserSize={showEraserSize} 
                    setShowEraserSize={setShowEraserSize}
                    setEraserSize={setEraserSize}
                  />
                ), (
                  <AnimatedSketchPad
                    ref={refSketch}
                    userId={userId}
                    currentTool={currentTool}
                    setCurrentTool={setCurrentTool}
                    currentToolOption={currentToolOption}
                    scale={animatedProps.value}
                    onScaleChange={setScale}
                    operations={operations}
                    onChange={onChange}
                    showEraserSize={showEraserSize}
                    setShowEraserSize={setShowEraserSize}
                    eraserSize={eraserSize}
                  />
                ))}
              </div>
            )}
          </ConfigContext.Consumer>
        </EnableSketchPadContext.Provider>
      </IntlProvider>
    </ConfigContext.Provider>
  );
}

export default Block;
