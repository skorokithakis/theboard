from __future__ import annotations

from whitenoise.storage import CompressedManifestStaticFilesStorage


class ProductionCompressedManifestStaticFilesStorage(
    CompressedManifestStaticFilesStorage
):
    """
    Force cache-busted filenames even when DEBUG stays enabled.

    The project keeps DEBUG=True in production, but we still want hashed static
    asset URLs for proper cache invalidation. Overriding url() ensures we always
    request the hashed name when this storage backend is active.
    """

    def url(self, name: str, force: bool = False) -> str:
        return super().url(name, force=True)
