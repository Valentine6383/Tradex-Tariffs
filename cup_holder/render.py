import sys, trimesh, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
m=trimesh.load(sys.argv[1]); L=np.array([0.4,-0.5,0.8]);L/=np.linalg.norm(L)
sh=np.clip(m.face_normals@L,0,1)*0.6+0.15; cols=np.c_[sh,sh,sh*1.05,np.ones_like(sh)].clip(0,1)
fig=plt.figure(figsize=(12,6))
for i,(el,az) in enumerate([(22,-60),(5,-90)]):
    ax=fig.add_subplot(1,2,i+1,projection='3d')
    ax.add_collection3d(Poly3DCollection(m.triangles,facecolors=cols,edgecolors=cols,linewidths=0.1))
    ax.set_xlim(-70,70);ax.set_ylim(-70,70);ax.set_zlim(0,140);ax.set_box_aspect((1,1,1));ax.view_init(el,az);ax.axis('off')
plt.savefig(sys.argv[2],dpi=100,bbox_inches='tight')
