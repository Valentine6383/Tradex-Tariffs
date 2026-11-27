"""Органайзер-пепельница в подстаканник авто: конусный стакан + крышка с карманами.
Все размеры в мм, меняй под себя и перезапускай: python3 make.py"""
from manifold3d import Manifold, CrossSection
import trimesh, numpy as np

SEG = 160
# --- стакан ---
BOT_D, TOP_D, H = 68.0, 76.0, 90.0   # низ / верх / высота (низ должен влезать в подстаканник)
WALL, FLOOR = 2.4, 2.0
# --- крышка ---
CLR = 0.25          # зазор посадки на сторону
PLUG_H = 6.0        # высота пробки, входящей в стакан
LID_D = 80.0        # диаметр «шляпки» крышки
PLATE = 3.0
BLOCK_H = 30.0      # высота надстройки с карманами
HOLE_D = 9.0        # дырка для бычков (проваливаются в стакан)
# карманы: (центр X, ширина X, длина Y, форма)
POCKETS = [(-6.0, 18.0, 50.0, 'rect'),    # под пачку стиков / зажигалку
           (18.0, 24.0, 50.0, 'stadium')] # под IQOS / вейп
BLOCK_X, BLOCK_Y, BLOCK_CX = 52.0, 60.0, 8.0
HOLE_X = -28.0

def cyl(h, d1, d2=None, z=0):
    return Manifold.cylinder(h, d1 / 2, (d2 if d2 else d1) / 2, SEG).translate((0, 0, z))

def box(sx, sy, sz, cx=0, cy=0, z=0):
    return Manifold.cube((sx, sy, sz)).translate((cx - sx / 2, cy - sy / 2, z))

def stadium(w, l, h, cx, z):
    r = w / 2
    cs = CrossSection.circle(r, 64).translate((0, l / 2 - r)) + CrossSection.circle(r, 64).translate((0, -(l / 2 - r)))
    cs = cs.hull()
    return Manifold.extrude(cs, h).translate((cx, 0, z))

# Стакан
k = (TOP_D - BOT_D) / H
body = cyl(H, BOT_D, TOP_D) - cyl(H, BOT_D - 2 * WALL + k * FLOOR, TOP_D - 2 * WALL + 0.01, z=FLOOR)
inner_top = TOP_D - 2 * WALL

# Крышка (печатается как есть: пробкой на стол, без поддержек)
plug_d = inner_top - 2 * CLR
plug_bot_d = plug_d - k * PLUG_H          # пробка тоже чуть конусная, как стакан
cham = (LID_D - plug_d) / 2                # фаска 45° вместо нависания
z_plate = PLUG_H + cham
lid = cyl(PLUG_H, plug_bot_d, plug_d) + cyl(cham, plug_d, LID_D, z=PLUG_H) + cyl(PLATE, LID_D, z=z_plate)
z_top = z_plate + PLATE
lid += box(BLOCK_X, BLOCK_Y, BLOCK_H, cx=BLOCK_CX, z=z_top)
# скругляем надстройку по кругу шляпки, чтобы не торчала
lid = lid ^ (cyl(z_top + BLOCK_H + 1, LID_D, z=-0.5))
for cx, w, l, shape in POCKETS:
    cut = box(w, l, BLOCK_H + 1, cx=cx, z=z_top) if shape == 'rect' else stadium(w, l, BLOCK_H + 1, cx, z_top)
    lid -= cut
lid -= Manifold.cylinder(100, HOLE_D / 2, HOLE_D / 2, 64).translate((HOLE_X, 0, -1))
# выемка под палец у прямоугольного кармана, чтобы доставать пачку
wall_x = BLOCK_CX - BLOCK_X / 2
lid -= Manifold.cylinder(8, 8, 8, 64).rotate((0, 90, 0)).translate((wall_x - 2, 0, z_top + BLOCK_H + 2))

def save(m, name):
    mesh = m.to_mesh()
    t = trimesh.Trimesh(mesh.vert_properties[:, :3], mesh.tri_verts)
    t.export(name)
    print(name, 'watertight', t.is_watertight, 'объём %.1f см³' % (t.volume / 1000), 'габарит', np.round(t.extents, 1))
    return t

save(body, 'stakan.stl')
save(lid, 'kryshka.stl')
