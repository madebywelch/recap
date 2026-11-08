import argparse
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path, help='One size directory containing light/ and dark/')
parser.add_argument('output', type=Path)
args = parser.parse_args()
files = sorted(args.directory.glob('*/*.png'))
if not files:
    raise SystemExit('No screenshots found')
width, height, columns = 400, 290, 4
rows = (len(files) + columns - 1) // columns
sheet = Image.new('RGB', (columns * width, rows * height), 'white')
draw = ImageDraw.Draw(sheet)
for i, path in enumerate(files):
    with Image.open(path) as source:
        image = source.convert('RGB')
        image.thumbnail((width - 16, height - 32))
        x, y = i % columns * width, i // columns * height
        sheet.paste(image, (x + 8, y + 24))
        draw.text((x + 8, y + 5), f'{path.parent.name}/{path.stem}', fill='black')
sheet.save(args.output)
