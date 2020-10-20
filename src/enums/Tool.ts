enum Tool {
  Select = 'Select',
  Stroke = 'Stroke',
  Shape = 'Shape',
  Text = 'Text',
  Latex = 'Latex',
  Emoji = 'Emoji',
  Image = 'Image',
  Undo = 'Undo',
  Redo = 'Redo',
  Clear = 'Clear',
  Eraser = 'Eraser',
  Zoom = 'Zoom',
  Save = 'Save',
  Update = 'Update',
  LazyUpdate = 'LazyUpdate',
  Remove = 'Remove',
  Highlighter = 'Highlighter',
}

export enum ShapeType {
  Rectangle = 'Rectangle',
  Oval = 'Oval',
  Triangle= 'Triangle'
} 

export const MAX_SCALE = 10;

export const MIN_SCALE = 0.1;

export interface Position {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const strokeSize = [2, 4, 6, 8, 10];

export const strokeColor = ['#4a4a4a', '#f55b6c', '#f7c924', '#63d321', '#50e3c2', '#59b9ff', '#bd10e0', '#ffffff', '#ffc0cb', '#ffa500'];

export enum TextSize {
  Small = 12,
  Default = 20,
  Large = 28,
  XL = 36
}

export enum LatexSize {
  Small = 12,
  Default = 20,
  Large = 28,
  XL = 100
}

export enum EmojiSize {
  Small = 12,
  Default = 20,
  Large = 28,
  XL = 100
}

export const defaultToolOption = {
  highlighterColor: strokeColor[2],
  highlighterSize: strokeSize[4],
  strokeSize: strokeSize[1],
  strokeColor: strokeColor[0],
  shapeType: ShapeType.Rectangle,
  shapeBorderColor: strokeColor[0],
  shapeBorderSize: 4,
  textColor: strokeColor[0],
  textSize: TextSize.Default,
  latexSize: LatexSize.Default,
  emojiSize: EmojiSize.Default,

  defaultLatex: {
    id: 'umi.block.sketch.latex.placeholder'
  },

  defaultEmoji: {
    id: 'umi.block.sketch.emoji.placeholder'
  },

  defaultText: {
    id: 'umi.block.sketch.text.placeholder'
  },
} 

export type ToolOption = {
  highlighterColor: string,
  highlighterSize: number,
  strokeSize: number,
  strokeColor: string,
  shapeType: ShapeType,
  shapeBorderColor: string,
  shapeBorderSize: number,
  textColor: string,
  textSize: TextSize,
  latexSize: LatexSize,
  emojiSize: EmojiSize,

  defaultText: string | {
    id: string,
  },
};

export default Tool;