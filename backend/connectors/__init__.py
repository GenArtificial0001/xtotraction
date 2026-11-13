from ..core.registry import ConnectorRegistry
from .http_source import HttpSource
from .http_target import HttpTarget
from .sharepoint import SharePointGraphSource, SharePointRestSource


def create_default_registry() -> ConnectorRegistry:
    """Único sitio donde se registran los conectores: añade aquí los nuevos."""
    return (ConnectorRegistry()
            .register(HttpSource)            # cualquier web/API: se configura importando un .har o un curl
            .register(SharePointGraphSource)  # SharePoint por sitio: lista las listas sin HAR
            .register(SharePointRestSource)
            .register(HttpTarget))
