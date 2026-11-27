"""Подставка-органайзер для одноразовых стаканчиков. Генерирует STL.
Все размеры в мм. Меняй параметры сверху под свои стаканы."""
import math, numpy as np, trimesh
from manifold3d import Manifold, set_circular_segments

set_circular_segments(64)

CUP_RIM_D   = 82     # внутренний проход между стойками (диаметр ободка стакана + зазор)
ROD_D       = 7      # толщина стоек
N_RODS      = 4
ROD_H       = 105    # высота прямой части стоек над основанием
FLARE_LEN   = 20     # длина отогнутого наружу кончика
FLARE_ANGLE = 35     # угол отгиба от вертикали, градусов (<=45 — печать без поддержек)
BASE_D      = 112
BASE_H      = 10
RECESS_D    = 96     # углубление под ободок перевёрнутого стакана
RECESS_DEPTH= 3
N_RIBS      = 60     # рифление по краю

rod_r = CUP_RIM_D / 2 + ROD_D / 2

def capsule(p1, p2, r):
    s = lambda p: Manifold.sphere(r).translate(tuple(p))
    return Manifold.batch_hull([s(p1), s(p2)])

# основание
base = Manifold.cylinder(BASE_H, BASE_D / 2 - 1.5)
rib = Manifold.cylinder(BASE_H - 1, 2.0).translate((BASE_D / 2 - 2, 0, 0.5))
ribs = Manifold.batch_boolean([rib.rotate((0, 0, i * 360 / N_RIBS)) for i in range(N_RIBS)], 
                              __import__('manifold3d').OpType.Add)
base = base + ribs
base = base - Manifold.cylinder(RECESS_DEPTH + 1, RECESS_D / 2).translate((0, 0, BASE_H - RECESS_DEPTH))
floor_z = BASE_H - RECESS_DEPTH

parts = [base]
a_rad = math.radians(FLARE_ANGLE)
for i in range(N_RODS):
    ang = 2 * math.pi * i / N_RODS + math.pi / N_RODS
    c, s = math.cos(ang), math.sin(ang)
    p0 = (rod_r * c, rod_r * s, floor_z)
    p1 = (rod_r * c, rod_r * s, BASE_H + ROD_H)
    rr = rod_r + FLARE_LEN * math.sin(a_rad)
    p2 = (rr * c, rr * s, BASE_H + ROD_H + FLARE_LEN * math.cos(a_rad))
    parts.append(capsule(p0, p1, ROD_D / 2))
    parts.append(capsule(p1, p2, ROD_D / 2))
    # усиление у основания (галтель-конус)
    parts.append(Manifold.cylinder(6, ROD_D / 2 + 3, ROD_D / 2).translate((p0[0], p0[1], floor_z)))

model = Manifold.batch_boolean(parts, __import__('manifold3d').OpType.Add)
# срезаем всё ниже нуля (полусфера низа стоек и т.п.)
model = model ^ Manifold.cube((400, 400, 400), center=True).translate((0, 0, 200))

mesh = model.to_mesh()
tm = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3], faces=np.asarray(mesh.tri_verts))
out = __file__.replace('.py', '.stl')
tm.export(out)
print('watertight:', tm.is_watertight, 'size mm:', tm.extents.round(1), 'volume cm3:', round(tm.volume / 1000, 1))
print(out)
