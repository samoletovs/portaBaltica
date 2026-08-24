"""Feed parsing tests.

The load-bearing assertion in this file is that ``<content:encoded>`` never
becomes reachable. Everything else is ordinary parsing.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.collect.rss import (
    ITEM_FIELD_ALLOWLIST,
    KNOWN_FULL_TEXT_ELEMENTS,
    _strip_forbidden,
    _text_of,
    extract_raw_description,
    parse_feed,
)

# Modelled on emerging-europe.com/feed, which ships the whole article body in
# <content:encoded> alongside a short <description>.
EMERGING_EUROPE_STYLE = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Emerging Europe</title>
    <item>
      <title>Baltic states agree new grid interconnection timetable</title>
      <link>https://emerging-europe.com/news/baltic-grid/</link>
      <description>The three Baltic states have agreed a revised timetable.</description>
      <content:encoded><![CDATA[<p>THE ENTIRE COPYRIGHTED ARTICLE BODY, several
      thousand words long, which republishing would be an Art. 15 infringement
      and a scaled-content-abuse violation simultaneously.</p>]]></content:encoded>
      <dc:creator>A Staff Writer</dc:creator>
      <pubDate>Mon, 24 Aug 2026 08:00:00 +0000</pubDate>
      <guid isPermaLink="false">https://emerging-europe.com/?p=12345</guid>
    </item>
  </channel>
</rss>
"""

ATOM_STYLE = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Commission adopts Baltic energy package</title>
    <link href="https://ec.europa.eu/item/1"/>
    <summary>The Commission today adopted a package.</summary>
    <content type="html">THE FULL TEXT THAT MUST NOT BE INGESTED</content>
    <id>urn:ec:1</id>
    <updated>2026-08-24T09:00:00Z</updated>
  </entry>
</feed>
"""


class TestContentEncodedIsUnreachable:
    def test_should_not_carry_the_full_body_anywhere_in_the_parsed_item(self):
        items = parse_feed(EMERGING_EUROPE_STYLE, source_id="emerging_europe", raw_blob="raw/1")

        assert len(items) == 1
        item = items[0]
        assert item.description == "The three Baltic states have agreed a revised timetable."
        # The body must not appear in *any* field of the parsed item.
        assert "ENTIRE COPYRIGHTED ARTICLE BODY" not in repr(item)

    def test_should_delete_forbidden_elements_before_extraction(self):
        from defusedxml import ElementTree as ET

        root = ET.fromstring(EMERGING_EUROPE_STYLE)
        item = next(e for e in root.iter() if e.tag.rsplit("}", 1)[-1] == "item")

        _strip_forbidden(item)

        remaining = {child.tag.rsplit("}", 1)[-1].lower() for child in item}
        assert "encoded" not in remaining
        assert remaining <= ITEM_FIELD_ALLOWLIST

    @pytest.mark.parametrize("tag", sorted(KNOWN_FULL_TEXT_ELEMENTS))
    def test_should_refuse_to_read_any_known_full_text_element(self, tag):
        from defusedxml import ElementTree as ET

        root = ET.fromstring(EMERGING_EUROPE_STYLE)
        item = next(e for e in root.iter() if e.tag.rsplit("}", 1)[-1] == "item")

        with pytest.raises(ValueError, match="not an allowlisted feed field"):
            _text_of(item, tag)

    def test_should_read_atom_summary_and_ignore_atom_content(self):
        items = parse_feed(ATOM_STYLE, source_id="ec_presscorner", raw_blob="raw/2")

        assert len(items) == 1
        assert items[0].description == "The Commission today adopted a package."
        assert "MUST NOT BE INGESTED" not in repr(items[0])

    def test_feed_item_has_no_field_capable_of_holding_a_body(self):
        from dataclasses import fields

        from newsroom.pipeline.models import FeedItem

        names = {f.name for f in fields(FeedItem)}
        assert names == {
            "source_id",
            "title",
            "link",
            "description",
            "published",
            "guid",
            "raw_blob",
            "retrieved_at",
        }


class TestFeedParsing:
    def test_should_extract_headline_link_and_guid(self):
        items = parse_feed(EMERGING_EUROPE_STYLE, source_id="emerging_europe", raw_blob="raw/1")

        item = items[0]
        assert item.title == "Baltic states agree new grid interconnection timetable"
        assert item.link == "https://emerging-europe.com/news/baltic-grid/"
        assert item.guid == "https://emerging-europe.com/?p=12345"
        assert item.raw_blob == "raw/1"

    def test_should_use_the_atom_link_href_attribute(self):
        items = parse_feed(ATOM_STYLE, source_id="ec_presscorner", raw_blob="raw/2")

        assert items[0].link == "https://ec.europa.eu/item/1"

    def test_should_skip_items_missing_a_title_or_link(self):
        feed = b"""<rss version="2.0"><channel>
            <item><description>orphan</description></item>
            <item><title>Kept item with a headline</title><link>https://x.invalid/1</link></item>
        </channel></rss>"""

        items = parse_feed(feed, source_id="lsm_en", raw_blob="raw/3")

        assert [i.title for i in items] == ["Kept item with a headline"]

    def test_should_return_nothing_for_malformed_xml_rather_than_raising(self):
        assert parse_feed(b"<rss><channel><item>", source_id="lsm_en", raw_blob="raw/4") == []

    def test_should_read_the_description_back_out_of_the_archived_bytes(self):
        description = extract_raw_description(
            EMERGING_EUROPE_STYLE, "https://emerging-europe.com/?p=12345"
        )

        assert description == "The three Baltic states have agreed a revised timetable."

    def test_should_return_none_when_the_guid_is_not_in_the_archived_feed(self):
        assert extract_raw_description(EMERGING_EUROPE_STYLE, "no-such-guid") is None
