// The "x y" screen pixels at the end of the current harness request (`TAP "x y"`) as output.x / output.y.
const [, x, y] = /(\d+) (\d+)"$/.exec(output.request ?? '') ?? [];
output.x = x;
output.y = y;
