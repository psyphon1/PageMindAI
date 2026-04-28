import sys
import os
import site

# Ensure the local .venv site-packages are in the path
site.addsitedir(os.path.abspath(os.path.join(os.path.dirname(__file__), '.venv', 'Lib', 'site-packages')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'backend')))

import uvicorn

if __name__ == "__main__":
    print("Starting Universal RAG API Server...")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, app_dir="backend")
