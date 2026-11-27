"""Подставка-органайзер для одноразовых стаканчиков — копия с фото маркетплейса.
Основание-тарелка с рифлёным краем и бортиком + две проволочные петли-«ушка»
друг напротив друга. Каждая петля лежит в радиальной плоскости: внутренняя
стойка вертикальная (вдоль стопки стаканов), наружная расходится наружу,
сверху они соединены скруглением. Пропорции сняты с фото и отмасштабированы
под проход CUP_RIM_D. Генерирует STL. Все размеры в мм."""
import math
import numpy as np
import trimesh
from manifold3d import Manifold, OpType, set_circular_segments

set_circular_segments(48)

CUP_RIM_D   = 82     # проход между внутренними стойками (ободок стакана + зазор); 250 мл ≈ 80 мм
WIRE_D      = 5.5    # толщина «проволоки»
N_LOOPS     = 2      # петли друг напротив друга, как на фото
LOOP_H      = 155    # высота петли над дном тарелки (до верха скругления)
GAP_BOTTOM  = 20     # расстояние между стойками петли внизу (по осям)
GAP_TOP     = 26     # расстояние между стойками петли вверху (по осям)
TOP_LEAN    = 9      # отгиб верхушки петли наружу (как на фото)
LEAN_H      = 30     # на какой высоте от верха начинается отгиб
BASE_D      = 160    # шире, чтобы раздвинутые ножки влезли и было устойчиво
BASE_H      = 15
FLOOR_T     = 11     # толщина сплошного дна (вес/устойчивость)
RIM_W       = 6      # ширина бортика
N_RIBS      = 100    # вертикальное рифление по краю

r = WIRE_D / 2
R_IN = CUP_RIM_D / 2 + r      # радиус внутренней стойки


def capsule(p1, p2, rad=r):
    s = lambda p: Manifold.sphere(rad).rotate((17, 29, 0)).translate(tuple(map(float, p)))
    return Manifold.batch_hull([s(p1), s(p2)])


def polyline(pts, rad=r):
    return [capsule(a, b, rad) for a, b in zip(pts[:-1], pts[1:])]


# ---------- основание-тарелка ----------
body = Manifold.cylinder(BASE_H, BASE_D / 2 - 1.8)
rib = Manifold.cylinder(BASE_H - 1.0, 2.1).translate((BASE_D / 2 - 2.1, 0, 0.5))
ribs = Manifold.batch_boolean(
    [rib.rotate((0, 0, i * 360 / N_RIBS)) for i in range(N_RIBS)], OpType.Add)
inner_r = BASE_D / 2 - RIM_W
pocket = Manifold.cylinder(BASE_H, inner_r).translate((0, 0, FLOOR_T))
base = (body + ribs) - pocket

parts = [base]

# ---------- петли-«ушки» ----------
z0 = FLOOR_T - 0.5
z_arc = FLOOR_T + LOOP_H - GAP_TOP / 2 - r      # центр верхнего скругления
for k in range(N_LOOPS):
    a = 2 * math.pi * k / N_LOOPS
    rad = np.array([math.cos(a), math.sin(a), 0.0])
    P = lambda rr, z: rad * rr + np.array([0, 0, z])

    zb = z_arc - LEAN_H
    k_out = GAP_BOTTOM + (GAP_TOP - GAP_BOTTOM) * (zb - z0) / (z_arc - z0)
    inner = [P(R_IN, z0), P(R_IN, zb), P(R_IN + TOP_LEAN, z_arc)]
    outer = [P(R_IN + TOP_LEAN + GAP_TOP, z_arc), P(R_IN + k_out, zb), P(R_IN + GAP_BOTTOM, z0)]
    c = P(R_IN + TOP_LEAN + GAP_TOP / 2, z_arc)
    arc = [c + (GAP_TOP / 2) * (-math.cos(t) * rad + np.array([0, 0, math.sin(t)]))
           for t in np.linspace(0, math.pi, 19)]
    parts += polyline(inner + arc[1:-1] + outer)

    # галтели у основания стоек
    for rr in (R_IN, R_IN + GAP_BOTTOM):
        foot = P(rr, 0)
        parts.append(Manifold.cylinder(3.5, r + 2.0, r)
                     .translate((foot[0], foot[1], FLOOR_T)))

model = Manifold.batch_boolean(parts, OpType.Add)
model = model ^ Manifold.cube((400, 400, 400), center=True).translate((0, 0, 200))

mesh = model.to_mesh()
tm = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3],
                     faces=np.asarray(mesh.tri_verts), process=True)
tm.merge_vertices(digits_vertex=4)
tm.update_faces(tm.nondegenerate_faces())
tm.update_faces(tm.unique_faces())
tm.remove_unreferenced_vertices()
tm.fill_holes()
trimesh.repair.fix_normals(tm)
out = __file__.replace('.py', '.stl')
tm.export(out)
print('watertight:', tm.is_watertight, 'size mm:', tm.extents.round(1),
      'volume cm3:', round(tm.volume / 1000, 1))
