import requests
from typing import List, Dict, Optional
from . import db
from .models import PropertyData
from flask import current_app
import json


class TestPropertyValuations:
    def setup_test_data(self):
        with open('comarable_properties_sample.json') as f:
            self.comparable_properties = json.load()
            