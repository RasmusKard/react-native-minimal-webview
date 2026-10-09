// The "x y" screen pixels at the end of the copied harness request (`TAP "x y"`) as output.x / output.y.
const [x, y] = maestro.copiedText.match(/(\d+) (\d+)"$/).slice(1);
output.x = x;
output.y = y;
