"""The guard that stops a newsroom unit test reaching the network, tested.

An unguarded guard is the failure this project keeps finding in other clothes.
``conftest.py`` could lose the patch, or a Python change could move where
``connect`` lives, and every symptom would be invisible: the suite would simply
start depending on Eurostat, Azure OpenAI and a dozen RSS feeds again, and would
fail on whichever morning one of them was slow.

Three things are asserted and the last two matter as much as the first. A guard
that refused *everything* would satisfy "the remote host is refused" while
breaking every async test in the suite -- measured before the guard was written,
asyncio's event-loop self-pipe on Windows is a socket pair over loopback, and it
accounts for all 126 connections the whole suite makes.
"""

from __future__ import annotations

import asyncio
import socket
import threading

import pytest

from newsroom.tests.conftest import NetworkAccessDenied


@pytest.mark.expects_blocked_network
def test_a_remote_connection_is_refused_and_says_why() -> None:
    # Never resolved and never dialled: the guard fires before DNS, so this
    # cannot itself be slow or flaky.
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        with pytest.raises(NetworkAccessDenied) as caught:
            sock.connect(("data.stat.gov.lv", 443))
    finally:
        sock.close()

    message = str(caught.value)
    assert "portaBaltica test guard" in message
    # The message has to name the remedy, because whoever reads it is looking at
    # a handler that suddenly cannot reach its upstream.
    assert "Stub the call" in message
    assert "data.stat.gov.lv:443" in message


@pytest.mark.expects_blocked_network
def test_connect_ex_is_refused_too() -> None:
    # `connect_ex` returns an errno instead of raising, which is precisely how a
    # caller could ignore the guard. It must still be refused.
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        result = sock.connect_ex(("data.stat.gov.lv", 443))
    finally:
        sock.close()

    import errno

    assert result == errno.ECONNREFUSED


@pytest.mark.expects_blocked_network
def test_an_ip_literal_cannot_walk_past_the_hostname_check() -> None:
    # The check is on the address, not on whether it looks like a hostname, so a
    # dotted quad is refused exactly as a name is. Without this the guard could
    # be bypassed by resolving first.
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        with pytest.raises(NetworkAccessDenied):
            sock.connect(("93.184.216.34", 443))
    finally:
        sock.close()


def test_loopback_is_left_alone() -> None:
    """The companion assertion, and the reason the guard is not a blanket.

    Without this the tests above pass on a guard that refuses every connection
    there is -- a different defect wearing the same green tick, and one that
    would take the whole async suite down with it.
    """
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    port = server.getsockname()[1]

    accepted: list[socket.socket] = []

    def accept() -> None:
        connection, _ = server.accept()
        accepted.append(connection)

    thread = threading.Thread(target=accept, daemon=True)
    thread.start()

    client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        client.connect(("127.0.0.1", port))
        thread.join(timeout=5)
        assert accepted, "the loopback connection never arrived"
    finally:
        client.close()
        for connection in accepted:
            connection.close()
        server.close()


async def test_the_async_suite_still_has_an_event_loop() -> None:
    """The case the loopback allowance actually exists for.

    On Windows an asyncio event loop builds its self-pipe from a socket pair over
    127.0.0.1. Measured across the whole suite: 126 connections, all loopback,
    and a file with async tests makes 23 of them where a file without makes none.
    Blocking loopback would not have degraded the async tests, it would have
    stopped them existing.
    """
    await asyncio.sleep(0)
    assert asyncio.get_running_loop() is not None


@pytest.mark.expects_blocked_network
def test_a_blocked_attempt_is_recorded_even_when_the_caller_swallows_it() -> None:
    """Raising is not enough on its own.

    Pipeline code catches broadly around its network calls. An exception alone
    could therefore be swallowed, leaving the test green with a silent new
    dependency, so the guard records the attempt and an autouse fixture fails the
    test that made it. This asserts the record exists; the marker is what stops
    that fixture failing *this* test for provoking it deliberately.
    """
    from newsroom.tests import conftest

    before = len(conftest._BLOCKED)

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        try:
            sock.connect(("eurostat.example", 443))
        except NetworkAccessDenied:
            pass  # exactly what a broad `except Exception` would do
    finally:
        sock.close()

    assert conftest._BLOCKED[before:] == ["eurostat.example:443"]
