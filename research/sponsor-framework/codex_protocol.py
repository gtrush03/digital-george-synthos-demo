"""Validated one-action envelope translated to the real Strands stream protocol."""

import json
import uuid
from jsonschema import Draft202012Validator


ACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["tool", "answer"]},
        "name": {"type": "string"},
        "input_json": {"type": "string"},
        "text": {"type": "string"},
    },
    "required": ["kind", "name", "input_json", "text"],
    "additionalProperties": False,
}


def action_events(action, tool_specs):
    """Validate BEFORE yielding any event; an invalid action cannot execute a tool."""
    Draft202012Validator(ACTION_SCHEMA).validate(action)
    if action["kind"] == "answer":
        if action["name"] or action["input_json"] not in ("", "{}"):
            raise ValueError("Answer must not contain a tool request")
        if not action["text"].strip():
            raise ValueError("Answer text is empty")
        body = [
            {"contentBlockStart": {"start": {}}},
            {"contentBlockDelta": {"delta": {"text": action["text"]}}},
        ]
        stop_reason = "end_turn"
    else:
        tools = {spec["name"]: spec for spec in tool_specs}
        if action["name"] not in tools:
            raise ValueError("Unknown or unavailable tool: " + action["name"])
        if action["text"]:
            raise ValueError("Tool request must not include answer text")
        arguments = json.loads(action["input_json"])
        if not isinstance(arguments, dict):
            raise ValueError("Tool input must be a JSON object")
        schema = tools[action["name"]].get("inputSchema", {}).get("json")
        if not isinstance(schema, dict):
            raise ValueError("Tool has no JSON input schema")
        # Forbid remote refs: tool schemas must be self-contained.
        def check_refs(value):
            if isinstance(value, dict):
                if "$ref" in value and not value["$ref"].startswith("#"):
                    raise ValueError("External schema references are not supported")
                for child in value.values():
                    check_refs(child)
            elif isinstance(value, list):
                for child in value:
                    check_refs(child)
        check_refs(schema)
        Draft202012Validator.check_schema(schema)
        Draft202012Validator(schema).validate(arguments)
        body = [
            {"contentBlockStart": {"start": {"toolUse": {
                "name": action["name"], "toolUseId": "codex_" + uuid.uuid4().hex,
            }}}},
            {"contentBlockDelta": {"delta": {"toolUse": {
                "input": json.dumps(arguments, ensure_ascii=False),
            }}}},
        ]
        stop_reason = "tool_use"
    return [
        {"messageStart": {"role": "assistant"}},
        *body,
        {"contentBlockStop": {}},
        {"messageStop": {"stopReason": stop_reason}},
    ]
