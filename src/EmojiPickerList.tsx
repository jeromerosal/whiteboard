import React, { useState } from "react";
import { Picker } from "emoji-mart";
import "emoji-mart/css/emoji-mart.css";
import { Emoji } from 'emoji-mart';

const EmojiPickerList = ({onEmojiSelect, currentEmoji}) => {
  return (
    <>
      <div id={'emojiId'} style={{position: 'fixed', width: 100, height: 100, top: 10, left: 10}}   >
        <Emoji set={'facebook'} emoji={currentEmoji} size={100}/>
      </div>
      <Picker set="facebook" tooltip={true} onSelect={onEmojiSelect}/>
    </>
  );
}

export default EmojiPickerList;