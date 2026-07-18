from pelorus_admin.models import Subscriber, parse_bug_body

SAMPLE = """\
date: 2026-07-18T12:40:26.738Z
email: tester@example.com

--- DESCRIPTION ---
Chart tiles blank near Boston Harbor
Second line of detail

--- DIAGNOSTICS ---
=== PELORUS NAV DIAGNOSTICS ===
version: 0.14.0
platform: android
userAgent: test
"""


def test_parse_bug_body():
    body = parse_bug_body(SAMPLE)
    assert body.date == "2026-07-18T12:40:26.738Z"
    assert body.email == "tester@example.com"
    assert body.first_line == "Chart tiles blank near Boston Harbor"
    assert "Second line" in body.description
    assert body.platform == "android"
    assert "userAgent: test" in body.diagnostics


def test_parse_bug_body_no_email_no_diag():
    body = parse_bug_body(
        "date: 2026-01-01T00:00:00Z\nemail: (none)\n\n"
        "--- DESCRIPTION ---\nHello\n\n--- DIAGNOSTICS ---\n(none)\n"
    )
    assert body.email == ""
    assert body.first_line == "Hello"
    assert body.platform == ""


def test_parse_bug_body_garbage():
    body = parse_bug_body("not a bug report at all")
    assert body.first_line == ""
    assert body.date == ""


def test_subscriber_from_record_defaults():
    sub = Subscriber.from_record(
        {"email": "a@b.co", "subscribedAt": "2026-07-01T00:00:00Z"}
    )
    assert sub.status == "new"
    assert sub.platforms == []
    assert sub.note == ""
