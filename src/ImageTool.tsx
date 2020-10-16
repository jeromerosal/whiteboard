import { MouseEvent } from 'react';
import Tool, { Position } from './enums/Tool';
import { mapClientToCanvas } from './utils';

export type Image = {
  imageData: string;
}

const _cacheImgs: {
  [any: string]: HTMLImageElement;
} = {};

const _cacheVids: {
  [any: string]: HTMLVideoElement;
} = {};

export const drawImage = (item: Image, context: CanvasRenderingContext2D, pos: Position, id: string, rerender: () => void) => {
  if (item.imageData.slice(0, 10) === 'data:image') {
    if (!_cacheImgs[id]) {
      fetch(item.imageData)
        .then(res => res.blob())
        .then(blob => {
          return new Promise<HTMLImageElement>((resolve, reject) => {
            let img = document.createElement('img');
            img.addEventListener('load', function() {
              resolve(this);
            });
            img.src = URL.createObjectURL(blob);
          });
        })
        .then(imageBitmap => {
          _cacheImgs[id] = imageBitmap;
          rerender();
        });
    } else {
      context.drawImage(_cacheImgs[id], pos.x, pos.y, pos.w, pos.h);
    }
  } else {
    if (!_cacheVids[id]) {
      fetch(item.imageData)
        .then(res => res.blob())
        .then(blob => {
          return new Promise<HTMLVideoElement>((resolve, reject) => {
            let vid = document.createElement('video');
            
            vid.autoplay = true;
            vid.loop = true;
            vid.src = URL.createObjectURL(blob);

            vid.addEventListener('play', function() {
              this.width = this.videoWidth / 2;
              this.height = this.videoHeight  / 2;
              resolve(this);
            });
          });
        })
        .then(imageBitmap => {
          _cacheVids[id] = imageBitmap;
          rerender();
        })
        .catch(e => console.log(e));
    } else {
      context.drawImage(_cacheVids[id], pos.x, pos.y, pos.w, pos.h);
    }
  }
}

export const onImageComplete = (data: string, canvas: HTMLCanvasElement, viewMatrix: number[], handleCompleteOperation: (tool?: Tool, data?: Image, pos?: Position) => void) => {
  const image = new Image();
  const video = document.createElement('video');

  if (data.slice(0, 10) === 'data:image') {
    image.onload = () => {
      const { top, left, } = canvas.getBoundingClientRect();
      const imageWidth = image.width;
      const imageHeight = image.height;
      const offsetWidth = canvas.offsetWidth;
      const offsetHeight = canvas.offsetHeight;

      const pos = mapClientToCanvas({
        clientX: left + (offsetWidth / 2 - imageWidth / 4),
        clientY: top + (offsetHeight / 2 - imageHeight / 4),
      } as MouseEvent<HTMLCanvasElement>, canvas, viewMatrix);
      const posEnd = mapClientToCanvas({
        clientX: left + (offsetWidth / 2 + imageWidth / 4),
        clientY: top + (offsetHeight / 2 + imageHeight / 4),
      } as MouseEvent<HTMLCanvasElement>, canvas, viewMatrix);

      const posInfo = {
        x: pos[0],
        y: pos[1],
        w: (posEnd[0] - pos[0]),
        h: (posEnd[1] - pos[1]),
      };

      handleCompleteOperation(Tool.Image, {
        imageData: data,
      }, posInfo);
    };
    image.src = data;
  } else {
    video.onloadstart = () => {
      const { top, left, } = canvas.getBoundingClientRect();
      const videoWidth = 900;
      const videoHeight = 900;
      const offsetWidth = canvas.offsetWidth;
      const offsetHeight = canvas.offsetHeight;

      const pos = mapClientToCanvas({
        clientX: left + (offsetWidth / 2 - videoWidth / 4),
        clientY: top + (offsetHeight / 2 - videoWidth / 4),
      } as MouseEvent<HTMLCanvasElement>, canvas, viewMatrix);
      const posEnd = mapClientToCanvas({
        clientX: left + (offsetWidth / 2 + videoWidth / 4),
        clientY: top + (offsetHeight / 2 + videoHeight / 4),
      } as MouseEvent<HTMLCanvasElement>, canvas, viewMatrix);

      const posInfo = {
        x: pos[0],
        y: pos[1],
        w: (posEnd[0] - pos[0]),
        h: (posEnd[1] - pos[1]),
      };

      handleCompleteOperation(Tool.Image, {
        imageData: data,
      }, posInfo);

    };
    video.src = data;
  }
}