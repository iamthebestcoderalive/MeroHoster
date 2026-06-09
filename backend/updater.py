import requests
import json
from typing import Dict, List, Any, Optional

class ModUpdater:
    def __init__(self, mc_version: str, loader: str):
        self.mc_version = mc_version
        self.loader = loader.lower()
        self.versions_cache = {}  # project_id -> list of versions
        self.project_to_id = {}   # slug or hash -> project_id
        
    def fetch_project_id_from_hash(self, file_hash: str) -> Optional[str]:
        try:
            r = requests.get(f"https://api.modrinth.com/v2/version_file/{file_hash}?algorithm=sha1", timeout=5)
            if r.status_code == 200:
                return r.json().get("project_id")
        except:
            pass
        return None

    def fetch_versions(self, project_id: str) -> List[Dict]:
        if project_id in self.versions_cache:
            return self.versions_cache[project_id]
            
        url = f"https://api.modrinth.com/v2/project/{project_id}/version"
        params = {
            "loaders": f'["{self.loader}"]',
            "game_versions": f'["{self.mc_version}"]'
        }
        try:
            r = requests.get(url, params=params, timeout=10)
            if r.status_code == 200:
                # Sort by date descending (newest first)
                versions = r.json()
                self.versions_cache[project_id] = versions
                return versions
        except Exception as e:
            print(f"Error fetching versions for {project_id}: {e}")
        
        self.versions_cache[project_id] = []
        return []

    def scan_updates(self, installed_mods: List[Dict]) -> Dict:
        """
        Calculates the optimal update plan.
        Returns:
        {
            "ready": [ { "filename", "old_version", "new_version", "url", "hash" } ],
            "chain": [ { "filename", "old_version", "new_version", "url", "hash", "reason" } ],
            "deleted": [ { "filename", "reason" } ]
        }
        """
        # 1. Identify project IDs for all installed mods
        # We need this to know what we are working with.
        installed_projects = {}
        for m in installed_mods:
            # First try hash if Modrinth URL
            url = m.get("url", "")
            pid = m.get("project_id")
            if not pid and url.startswith("https://cdn.modrinth.com/"):
                h = m.get("hash")
                if h:
                    pid = self.fetch_project_id_from_hash(h)
            if pid:
                installed_projects[pid] = m

        # 2. Fetch all available versions for these projects
        all_available_versions = {}
        for pid in installed_projects.keys():
            all_available_versions[pid] = self.fetch_versions(pid)

        # 3. Solver
        # For each project, we want the NEWEST version that does not conflict.
        # A conflict occurs if Project A picks version X, and Project B picks version Y,
        # and version Y has a dependency on Project A but requires version Z (Z != X).
        # Also, if a dependency is required but not installed, we should probably install it? 
        # (Though we assume the current pack works, so we just focus on updates).
        
        # To satisfy the user's specific middle-ground solver:
        # We start by proposing the LATEST version for everyone.
        proposed = {}
        for pid, versions in all_available_versions.items():
            if versions:
                proposed[pid] = versions[0] # Try newest
                
        # Iteratively resolve conflicts
        changed = True
        iterations = 0
        deleted = []
        
        while changed and iterations < 100:
            changed = False
            iterations += 1
            
            # Check all proposed versions
            for pid, p_version in list(proposed.items()):
                # What does p_version require?
                deps = p_version.get("dependencies", [])
                for dep in deps:
                    if dep.get("dependency_type") == "required":
                        dep_pid = dep.get("project_id")
                        dep_vid = dep.get("version_id")
                        
                        # If the dependency is one of our installed projects
                        if dep_pid in proposed:
                            current_dep_vid = proposed[dep_pid].get("id")
                            
                            if dep_vid and current_dep_vid != dep_vid:
                                # Conflict! Mod A (pid) requires Mod B (dep_pid) to be exactly 'dep_vid'.
                                # But Mod B is currently proposed as 'current_dep_vid'.
                                # Since Mod A *requires* this, we MUST force Mod B to be 'dep_vid'.
                                # Let's see if 'dep_vid' exists in Mod B's available versions.
                                found_dep_version = next((v for v in all_available_versions[dep_pid] if v["id"] == dep_vid), None)
                                
                                if found_dep_version:
                                    proposed[dep_pid] = found_dep_version
                                    changed = True
                                else:
                                    # Mod A requires a version of Mod B that doesn't exist for this mc_version!
                                    # So Mod A is incompatible. We must downgrade Mod A.
                                    idx = all_available_versions[pid].index(p_version)
                                    if idx + 1 < len(all_available_versions[pid]):
                                        proposed[pid] = all_available_versions[pid][idx + 1]
                                        changed = True
                                    else:
                                        # Mod A has no working versions! Delete it.
                                        del proposed[pid]
                                        deleted.append({"filename": installed_projects[pid]["filename"], "reason": f"Incompatible with dependent mod constraints."})
                                        changed = True
                                        break
        
        # Build the result plan
        plan = {
            "ready": [],
            "chain": [],
            "deleted": deleted
        }
        
        for pid, new_v in proposed.items():
            old_mod = installed_projects[pid]
            # Check if it actually changed
            old_hash = old_mod.get("hash")
            new_files = new_v.get("files", [])
            primary_file = next((f for f in new_files if f.get("primary")), new_files[0] if new_files else None)
            
            if primary_file:
                new_hash = primary_file.get("hashes", {}).get("sha1")
                if new_hash != old_hash:
                    # It's an update!
                    update_obj = {
                        "filename": primary_file.get("filename"),
                        "old_filename": old_mod.get("filename"),
                        "url": primary_file.get("url"),
                        "hash": new_hash,
                        "project_id": pid
                    }
                    plan["ready"].append(update_obj)
                    
        return plan

