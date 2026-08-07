import os
import json
import data_loader

class ConfigManager:
    def __init__(self):
        self.config = {}

    def save_config(self, session_name, data):
        self.config = data
        fpath = os.path.join(data_loader.CURRENT_SCAN_PATH, f"wallballs_config_{session_name}.json")
        try:
            with open(fpath, "w") as f:
                json.dump(self.config, f, indent=2)
            return True
        except Exception as e:
            print(f"Error saving config for {session_name}: {e}")
            return False
            
    def load_config(self, session_name):
        self.config = {} # Clear config
        fpath = os.path.join(data_loader.CURRENT_SCAN_PATH, f"wallballs_config_{session_name}.json")
        
        if os.path.exists(fpath):
            try:
                with open(fpath, "r") as f:
                    self.config = json.load(f)
                return self.config
            except Exception as e:
                print(f"Error loading config for {session_name}: {e}")
                
        # Create default config if it doesn't exist or failed to load
        self.config = {
            "session_name": session_name,
            "clean": "raw",
            "segMethod": "none",
            "segMode": "prominence",
            "signal": "x",
            "mathOp": "curve",
            "lowCut": 0.0,
            "highCut": 2.0,
            "accSeg": "none",
            "hrFreq": None,
            "axisRanges": {
                "time": None,
                "hr": None,
                "spec": None
            },
            "segmentsFile": None,
            "loadedSegments": []
        }
        
        try:
            with open(fpath, "w") as f:
                json.dump(self.config, f, indent=2)
        except Exception as e:
            print(f"Error creating default config for {session_name}: {e}")
            
        return self.config

# Global instance
config_manager = ConfigManager()
