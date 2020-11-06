import * as React from "react"

function IsoTriangle(props) {
  const { _color } = props;
  console.log(props)
  return (
    <svg width={204} height={177} viewBox="0 0 204 177" fill="none" {...props}>
      <path
        d="M4.987 174.5L102 5.032 199.013 174.5H4.987z"
        fill="#fff"
        stroke="#000"
        strokeWidth={5}
      />
    </svg>
  )
}

export default IsoTriangle
