"""DeepAgents Python application agent template.

A drop-in Python port of the TypeScript ``packages/template`` agent
template, layered on top of pydantic-ai + pydantic-deepagents.

Entry points:

* :func:`main` (CLI dispatch — invoked by the ``deepagents-app`` script)
* :mod:`deepagents_template.runtime` (engine — protected zone)
* :mod:`deepagents_template.app` (business tools — AI-editable zone)
* :mod:`deepagents_template.surfaces` (ACP server + CLI surfaces)
"""

from __future__ import annotations

from importlib.metadata import version as _v

__version__ = _v("deepagents-dev-templates-python")
__all__ = ["__version__"]
