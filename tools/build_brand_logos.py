import os
import io
import base64
import numpy as np
from PIL import Image

def remove_white_bg(img, bg_cutoff=250, fade_range=10):
    img = img.convert('RGBA')
    data = np.array(img, dtype=np.float32)
    rgb = data[:, :, :3]
    diff = 255.0 - rgb
    max_diff = np.max(diff, axis=2)
    bg_diff = 255.0 - bg_cutoff
    alpha = np.where(max_diff <= bg_diff, 0.0, 
                     np.clip((max_diff - bg_diff) / fade_range * 255.0, 0.0, 255.0))
    a_norm = np.clip(alpha / 255.0, 0.0001, 1.0)[:, :, np.newaxis]
    fg = (rgb - (1.0 - a_norm) * 255.0) / a_norm
    fg = np.clip(fg, 0, 255)
    result = np.zeros_like(data)
    result[:, :, :3] = fg
    result[:, :, 3] = alpha
    return Image.fromarray(result.astype(np.uint8))

p1 = 'C:/Users/Mo_Matany/.gemini/antigravity/brain/108c6995-4aac-426e-bde6-20b180027bbf/.user_uploaded/media_1792501398329_7ed75360.jpg'
p2 = 'C:/Users/Mo_Matany/.gemini/antigravity/brain/108c6995-4aac-426e-bde6-20b180027bbf/.user_uploaded/media_1792501398343_391cdb3a.jpg'

print('Processing Icon Emblem...')
im1 = Image.open(p1)
trans1 = remove_white_bg(im1, bg_cutoff=250, fade_range=10)
bbox1 = trans1.getbbox()
w1 = bbox1[2] - bbox1[0]
h1 = bbox1[3] - bbox1[1]
side = max(w1, h1) + 40
sq1 = Image.new('RGBA', (side, side), (0,0,0,0))
sq1.paste(trans1.crop(bbox1), (side//2 - w1//2, side//2 - h1//2))

icon1024 = sq1.resize((1024, 1024), Image.Resampling.LANCZOS)
icon512 = sq1.resize((512, 512), Image.Resampling.LANCZOS)
icon128 = sq1.resize((128, 128), Image.Resampling.LANCZOS)
icon48 = sq1.resize((48, 48), Image.Resampling.LANCZOS)
icon32 = sq1.resize((32, 32), Image.Resampling.LANCZOS)
icon16 = sq1.resize((16, 16), Image.Resampling.LANCZOS)

print('Processing Full Logo...')
im2 = Image.open(p2)
trans2 = remove_white_bg(im2, bg_cutoff=250, fade_range=10)
bbox2 = trans2.getbbox()
cropped2 = trans2.crop(bbox2)
pad_x, pad_y = 16, 12
full_padded = Image.new('RGBA', (cropped2.width + pad_x*2, cropped2.height + pad_y*2), (0,0,0,0))
full_padded.paste(cropped2, (pad_x, pad_y))

def make_svg(img, title='Ehdar Logo'):
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
    w, h = img.size
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">
  <title>{title}</title>
  <image width="{w}" height="{h}" href="data:image/png;base64,{b64}" style="image-rendering: -webkit-optimize-contrast; shape-rendering: geometricPrecision;" />
</svg>'''

icon_svg = make_svg(icon512, 'Ehdar QR Attendance Emblem')
full_svg = make_svg(full_padded, 'Ehdar QR ATTD Official Brand Logo')

dirs = [
    'C:/Projects/AVQT/client/assets',
    'C:/Projects/AVQT/public/assets',
    'C:/Projects/AVQT/extension',
    'C:/Projects/AVQT/public/ext'
]

for d in dirs:
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'ehdar-icon.svg'), 'w', encoding='utf-8') as f:
        f.write(icon_svg)
    with open(os.path.join(d, 'ehdar-logo-full.svg'), 'w', encoding='utf-8') as f:
        f.write(full_svg)
    with open(os.path.join(d, 'avqr-logo.svg'), 'w', encoding='utf-8') as f:
        f.write(full_svg)
    icon512.save(os.path.join(d, 'ehdar-icon.png'))
    full_padded.save(os.path.join(d, 'ehdar-logo-full.png'))

ext_icon_dirs = [
    'C:/Projects/AVQT/extension/icons',
    'C:/Projects/AVQT/public/ext/icons'
]
for d in ext_icon_dirs:
    os.makedirs(d, exist_ok=True)
    icon128.save(os.path.join(d, 'icon128.png'))
    icon48.save(os.path.join(d, 'icon48.png'))
    icon32.save(os.path.join(d, 'icon32.png'))
    icon16.save(os.path.join(d, 'icon16.png'))

# Favicon in root / public / client
icon32.save('C:/Projects/AVQT/public/favicon.png')
icon32.save('C:/Projects/AVQT/client/favicon.png')
icon512.save('C:/Projects/AVQT/public/apple-touch-icon.png')
icon512.save('C:/Projects/AVQT/client/apple-touch-icon.png')

# Save ICO
icon32.save('C:/Projects/AVQT/public/favicon.ico', format='ICO', sizes=[(16,16), (32,32), (48,48)])
icon32.save('C:/Projects/AVQT/client/favicon.ico', format='ICO', sizes=[(16,16), (32,32), (48,48)])

print('Successfully generated and placed all brand logos and icons!')
