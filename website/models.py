from . import db
from flask_login import UserMixin
from sqlalchemy.sql import func


# creating classes with one to many relationships
class Note(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    data = db.Column(db.String(10000))
    date = db.Column(db.DateTime(timezone=True), default=func.now())
    user_id = db.Column(db.Integer, db.ForeignKey('user.id')) # this ForreignKey is used to link to the User model via the user_id


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(150), unique=True)
    password = db.Column(db.String(150))
    first_name = db.Column(db.String(150))
    notes = db.relationship('Note') # the .relationship is used to link to the Note model ps. to link with the name of the class it needs to be capitalised 'Note'
    appraisals = db.relationship('Appraisal')


class Appraisal(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    address = db.Column(db.String(200), nullable=False)
    bedrooms = db.Column(db.Integer)
    bathrooms = db.Column(db.Integer)
    property_type = db.Column(db.String(50))
    land_size = db.Column(db.Float)
    floor_area = db.Column(db.Float)
    condition = db.Column(db.Integer)
    features = db.Column(db.String(500))  # Will store features as a comma-separated string
    status = db.Column(db.String(50), default='In Progress')
    date_created = db.Column(db.DateTime(timezone=True), default=func.now())
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    comparable_properties = db.relationship('ComparableProperty', backref='appraisal', lazy=True)
    chat_messages = db.relationship('ChatMessage', backref='appraisal', lazy=True)


class ComparableProperty(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    address = db.Column(db.String(200), nullable=False)
    postcode = db.Column(db.String(20))
    bedrooms = db.Column(db.Integer)
    bathrooms = db.Column(db.Integer)
    floor_area = db.Column(db.Float)
    image_url = db.Column(db.String(500))
    price = db.Column(db.Float)
    square_feet = db.Column(db.Float)
    days_on_market = db.Column(db.Integer)
    distance_to = db.Column(db.Float)
    location_adjustment = db.Column(db.Float, default=0.0)
    size_adjustment = db.Column(db.Float, default=0.0)
    market_adjustment = db.Column(db.Float, default=0.0)
    adjusted_value = db.Column(db.Float)
    appraisal_id = db.Column(db.Integer, db.ForeignKey('appraisal.id'), nullable=False)


class ChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String(1000), nullable=False)
    is_user = db.Column(db.Boolean, default=True)
    timestamp = db.Column(db.DateTime(timezone=True), default=func.now())
    appraisal_id = db.Column(db.Integer, db.ForeignKey('appraisal.id'), nullable=False)


class PropertyData(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    external_id = db.Column(db.String(50), unique=True)  # e.g., "Z70132997"
    address = db.Column(db.String(200), nullable=False)
    postcode = db.Column(db.String(20))
    property_type = db.Column(db.String(50))
    bedrooms = db.Column(db.Integer)
    price = db.Column(db.Float)
    square_feet = db.Column(db.Float)
    days_on_market = db.Column(db.Integer)
    sstc = db.Column(db.Boolean, default=False)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    distance_to = db.Column(db.Float)
    summary = db.Column(db.Text)
    highest_offer = db.Column(db.Float)
    url = db.Column(db.String(500))
    date_added = db.Column(db.DateTime(timezone=True), default=func.now())
    
    # Foreign keys
    appraisal_id = db.Column(db.Integer, db.ForeignKey('appraisal.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    
    # Relationships
    appraisal = db.relationship('Appraisal', backref='property_data')
    user = db.relationship('User', backref='property_data')






