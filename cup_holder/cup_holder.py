"""Подставка-органайзер для одноразовых стаканчиков (как на фото с маркетплейса).
Круглое основание-тарелка с рифлёным краем + проволочные петли-«шпильки»,
верх которых отогнут наружу. Генерирует STL. Все размеры в мм."""
import math
import numpy as np
import trimesh
from manifold3d import Manifold, OpType, set_circular_segments

set_circular_segments(48)

CUP_RIM_D    = 82    # проход между стойками (ободок стакана + зазор); 250 мл ≈ 80 мм
WIRE_D       = 5.5   # толщина «проволоки»
N_LOOPS      = 3     # сколько петель-шпилек по кругу
LOOP_W       = 18    # расстояние между двумя стойками одной петли (по осям)
STRAIGHT_H   = 95    # высота прямой части над основанием
LEAN_H       = 22    # высота отогнутого участка
LEAN_OUT     = 10    # насколько верх петли уходит наружу
BASE_D       = 108
BASE_H       = 9
FLOOR_T      = 4     # толщина дна тарелки
RIM_W        = 5     # ширина бортика
N_RIBS       = 72    # рифление по краю

r = WIRE_D / 2
R = CUP_RIM_D / 2 + r          # радиус, на котором стоят стойки


def capsule(p1, p2, rad=r):
    s = lambda p: Manifold.sphere(rad).translate(tuple(map(float, p)))
    return Manifold.batch_hull([s(p1), s(p2)])


def polyline(pts, rad=r):
    return [capsule(a, b, rad) for a, b in zip(pts[:-1], pts[1:])]


# ---------- основание-тарелка ----------
body = Manifold.cylinder(BASE_H, BASE_D / 2 - 1.6)
rib = Manifold.cylinder(BASE_H - 1.2, 1.9).translate((BASE_D / 2 - 1.9, 0, 0.6))
ribs = Manifold.batch_boolean(
    [rib.rotate((0, 0, i * 360 / N_RIBS)) for i in range(N_RIBS)], OpType.Add)
inner_r = BASE_D / 2 - RIM_W
pocket = Manifold.cylinder(BASE_H, inner_r).translate((0, 0, FLOOR_T))
base = (body + ribs) - pocket
# лёгкая фаска-кольцо по внутреннему краю бортика (как на фото)
base = base + (Manifold.cylinder(1.2, inner_r) - Manifold.cylinder(1.2, inner_r - 1.5)) \
    .translate((0, 0, FLOOR_T))

parts = [base]

# ---------- петли-шпильки ----------
half_ang = math.asin((LOOP_W / 2) / R)
z0 = FLOOR_T - 0.5
z1 = BASE_H + STRAIGHT_H
z2 = z1 + LEAN_H
for k in range(N_LOOPS):
    a = 2 * math.pi * k / N_LOOPS
    radial = np.array([math.cos(a), math.sin(a), 0.0])
    tang = np.array([-math.sin(a), math.cos(a), 0.0])
    tops = []
    for sgn in (-1, 1):
        ang = a + sgn * half_ang
        foot = np.array([R * math.cos(ang), R * math.sin(ang), 0.0])
        p0 = foot + [0, 0, z0]
        p1 = foot + [0, 0, z1]
        p2 = foot + radial * LEAN_OUT + [0, 0, z2]
        mid = p1 + np.array([0, 0, LEAN_H * 0.35]) + radial * LEAN_OUT * 0.12
        parts += polyline([p0, p1, mid, p2])
        # утолщение-галтель в основании стойки
        parts.append(Manifold.cylinder(4, r + 2.2, r).translate(tuple(foot + [0, 0, FLOOR_T])))
        tops.append(p2)
    # верхняя дуга, замыкающая петлю (полуокружность, наклонена наружу)
    c = (tops[0] + tops[1]) / 2
    up = np.array([0, 0, 1.0]) * 0.85 + radial * 0.5
    up /= np.linalg.norm(up)
    half = np.linalg.norm(tops[1] - tops[0]) / 2
    e = (tops[1] - tops[0]) / (2 * half)
    arc = [c + half * (-math.cos(t) * e + math.sin(t) * up)
           for t in np.linspace(0, math.pi, 17)]
    parts += polyline(arc)

model = Manifold.batch_boolean(parts, OpType.Add)
model = model ^ Manifold.cube((400, 400, 400), center=True).translate((0, 0, 200))

mesh = model.to_mesh()
tm = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3],
                     faces=np.asarray(mesh.tri_verts))
out = __file__.replace('.py', '.stl')
tm.export(out)
print('watertight:', tm.is_watertight, 'size mm:', tm.extents.round(1),
      'volume cm3:', round(tm.volume / 1000, 1))
