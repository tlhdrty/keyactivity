#!/usr/bin/env python3
"""Generates simple colored PNG icons for the extension."""
import struct, zlib, os

def png(width, height, pixels):
    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    raw = b''
    for row in pixels:
        raw += b'\x00'
        for r, g, b in row:
            raw += bytes([r, g, b])

    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def make_icon(size):
    BG  = (79, 70, 229)   # #4F46E5 indigo
    ACC = (255, 255, 255)  # white
    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            # Rounded corners (simple distance check from corner)
            r = size // 4
            corners = [
                (x < r and y < r and (x - r)**2 + (y - r)**2 > r**2),
                (x >= size - r and y < r and (x - (size - r))**2 + (y - r)**2 > r**2),
                (x < r and y >= size - r and (x - r)**2 + (y - (size - r))**2 > r**2),
                (x >= size - r and y >= size - r and (x - (size - r))**2 + (y - (size - r))**2 > r**2),
            ]
            if any(corners):
                row.append((240, 240, 240))  # near-white corner
                continue

            # Draw a simple keyboard key symbol in center
            cx, cy = size // 2, size // 2
            sw = max(1, size // 10)  # stroke width

            # Horizontal bar
            if abs(y - cy) <= sw and abs(x - cx) <= size // 3:
                row.append(ACC)
            # Vertical bar
            elif abs(x - cx) <= sw and abs(y - cy) <= size // 3:
                row.append(ACC)
            else:
                row.append(BG)
        pixels.append(row)
    return png(size, size, pixels)


os.chdir(os.path.dirname(os.path.abspath(__file__)))
for size in [16, 48, 128]:
    data = make_icon(size)
    with open(f'icon{size}.png', 'wb') as f:
        f.write(data)
    print(f'  icon{size}.png created ({len(data)} bytes)')

print('Done.')
