"""Shared constants for the Poop SimCity preprocessor."""

# Seconds per simulation tick (5 minutes).
TICK_INTERVAL_SEC = 300

# Venue type order is the source of truth for venue_type_id encoding.
VENUE_TYPES = ["Apartment", "Workplace", "Restaurant", "Pub"]
VENUE_TYPE_TO_ID = {name: i for i, name in enumerate(VENUE_TYPES)}

# Disease state string -> integer code used throughout the bundle.
STATE_CODES = {"Susceptible": 0, "Exposed": 1, "Infectious": 2, "Recovered": 3}
STATE_CODE_NAMES = {"S": 0, "E": 1, "I": 2, "R": 3}
