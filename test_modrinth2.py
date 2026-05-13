import httpx
import asyncio

async def run():
    async with httpx.AsyncClient() as c:
        # fetch sodium
        r = await c.get('https://api.modrinth.com/v2/project/sodium/version')
        versions = r.json()
        print(f"sodium dependencies: {versions[0].get('dependencies')}")
        
        # let's try getting the project details for a dep
        dep_id = versions[0]['dependencies'][0]['project_id']
        r2 = await c.get(f'https://api.modrinth.com/v2/project/{dep_id}')
        proj = r2.json()
        print(f"dep title: {proj.get('title')}, icon: {proj.get('icon_url')}")

asyncio.run(run())
