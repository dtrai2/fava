# pylint: disable=missing-docstring

from os import path

import pytest

from fava.core.documents import is_document_or_import_file
from fava.core.documents import filepath_in_document_folder
from fava.helpers import FavaAPIException


def test_is_document_or_import_file(example_ledger):
    old_dirs = example_ledger.fava_options["import-dirs"]
    example_ledger.fava_options["import-dirs"] = ["/test/"]
    assert not is_document_or_import_file("/asdfasdf", example_ledger)
    assert not is_document_or_import_file("/test/../../err", example_ledger)
    assert is_document_or_import_file("/test/err/../err", example_ledger)
    assert is_document_or_import_file("/test/err/../err", example_ledger)
    example_ledger.fava_options["import-dirs"] = old_dirs


def test_filepath_in_documents_folder(example_ledger):
    old_dirs = example_ledger.options["documents"]
    example_ledger.options["documents"] = ["/test"]

    def _join(start: str, *args) -> str:
        return path.abspath(path.join(start, *args))

    assert filepath_in_document_folder(
        "/test", "Assets:US:BofA:Checking", "filename", example_ledger
    ) == _join("/test", "Assets", "US", "BofA", "Checking", "filename")
    assert filepath_in_document_folder(
        "/test", "Assets:US:BofA:Checking", "file/name", example_ledger
    ) == _join("/test", "Assets", "US", "BofA", "Checking", "file name")
    assert filepath_in_document_folder(
        "/test", "Assets:US:BofA:Checking", "/../file/name", example_ledger
    ) == _join("/test", "Assets", "US", "BofA", "Checking", " .. file name")
    with pytest.raises(FavaAPIException):
        filepath_in_document_folder(
            "/test", "notanaccount", "filename", example_ledger
        )
    with pytest.raises(FavaAPIException):
        filepath_in_document_folder(
            "/notadocumentsfolder",
            "Assets:US:BofA:Checking",
            "filename",
            example_ledger,
        )
    example_ledger.options["documents"] = old_dirs