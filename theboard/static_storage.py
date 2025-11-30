from __future__ import annotations

from whitenoise.storage import CompressedManifestStaticFilesStorage


class ProductionCompressedManifestStaticFilesStorage(
    CompressedManifestStaticFilesStorage
):
    """
    Force cache-busted filenames even if DEBUG is temporarily enabled.

    The project runs with DEBUG=False, but we still want hashed static asset
    URLs if DEBUG ever gets toggled for troubleshooting. Overriding url()
    ensures we always request the hashed name when this storage backend is
    active.
    """

    def url(self, name: str, force: bool = False) -> str:
        return super().url(name, force=True)
