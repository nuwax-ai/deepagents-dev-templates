"""Allow ``python -m deepagents_template`` to invoke the CLI."""
from __future__ import annotations

import sys

from deepagents_template.main import main

if __name__ == "__main__":
    sys.exit(main())
