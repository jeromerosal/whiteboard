import * as React from "react"

function IsoTriangle(props) {
  const { _color } = props;
  console.log(props)
  return (
    <svg width={139} height={120} viewBox="0 0 139 120" fill="none">
      <path
        d="M2.383 118.25L69.5 2l67.117 116.25H2.383z"
        fill="#fff"
        stroke={_color?_color:"#000"}
        strokeWidth={2}
      />
    </svg>
  )
}

export default IsoTriangle
