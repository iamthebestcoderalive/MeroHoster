import httpx
import asyncio

async def run():
    async with httpx.AsyncClient() as c:
        r = await c.get('https://api.modrinth.com/v2/project/P7dR8mSH/version')
        print(r.json()[0]['dependencies'])

asyncio.run(run())
