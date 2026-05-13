import httpx
import asyncio

async def run():
    async with httpx.AsyncClient() as c:
        # get fabulously optimized modpack versions
        r = await c.get('https://api.modrinth.com/v2/project/fabulously-optimized/version')
        v = r.json()[0]
        # find the mrpack file
        file = next((f for f in v["files"] if f["filename"].endswith(".mrpack")), None)
        print("mrpack url:", file["url"])

asyncio.run(run())
