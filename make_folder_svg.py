def make_svg(x, a, b, c, strokeWidth, circle_x, circle_y, circle_r):
    viewBox_x = 5*x + a + b
    viewBox_y = 5*x + c
    viewBox = max(viewBox_x, viewBox_y)
    svg_str = f'''<svg xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 {viewBox} {viewBox}"
        fill="none"
        stroke="currentColor"
        stroke-width="{strokeWidth}"
        width="32"
        height="32">
    <rect class="hidden" width="100%" height="100%" stroke="none" fill="#FFFFFF" />
    <path d="
      M {x} {x+x+x}
      v {c}
      q 0 {x} {x} {x}
      h {a+x+b}
      q {x} 0 {x} {-x}
      v {-c}
      q 0 {-x} {-x} {-x}
      h {-b}
      q 0 {-x} {-x} {-x}
      h {-a}
      q {-x} 0 {-x} {x}
      z"/>
    <g class="plus">
      <circle cx="{circle_x}" cy="{circle_y}" r="{circle_r}" fill="#2ecc71" stroke="none"/>
      <rect x="{circle_x - circle_r/2}" y="{circle_y - strokeWidth/2}" width="{circle_r}" height="{strokeWidth}" rx="{strokeWidth/2}" fill="#fff" stroke="none"/>
      <rect x="{circle_x - strokeWidth/2}" y="{circle_y - circle_r/2}" width="{strokeWidth}" height="{circle_r}" rx="{strokeWidth/2}" fill="#fff" stroke="none"/>
    </g>
    <g class="minus">
      <circle cx="{circle_x}" cy="{circle_y}" r="{circle_r}" fill="#e74c3c" stroke="none"/>
      <rect x="{circle_x - circle_r/2}" y="{circle_y - strokeWidth/2}" width="{circle_r}" height="{strokeWidth}" rx="{strokeWidth/2}" fill="#fff" stroke="none"/>
    </g>
    </svg>
    '''
    return svg_str



x = 10
a = 1*x
b = 2*x
c = 2*x
strokeWidth = 6
(circle_x, circle_y) = (x+x+a+x+b-x/4, x+x+x+c+x/4)
circle_r = 2*x
svg_str = make_svg(x, a, b, c, strokeWidth, circle_x, circle_y, circle_r)
with open(f"folder.svg", "w") as f:
    f.write(svg_str)
