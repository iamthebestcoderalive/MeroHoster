import sys; sys.path.append('backend'); import time; t0=time.time(); from backend.mero_host import check_zombies; check_zombies(); print(f'check_zombies time: {time.time()-t0:.2f}')  
