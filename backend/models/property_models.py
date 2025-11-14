"""Property-centric models for SQLAlchemy"""

from datetime import datetime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from .. import db
import uuid

class Property(db.Model):
    """Central property node that links all related documents and data"""
    __tablename__ = 'properties'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), nullable=False)
    address_hash = db.Column(db.String(64), nullable=False)
    normalized_address = db.Column(db.String(500), nullable=False)
    formatted_address = db.Column(db.String(500))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    geocoding_status = db.Column(db.String(50))
    geocoding_confidence = db.Column(db.Float)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_enrichment_at = db.Column(db.DateTime(timezone=True))
    completeness_score = db.Column(db.Float, default=0.0)
    
    # Relationships
    details = db.relationship('PropertyDetails', uselist=False, back_populates='property')
    documents = db.relationship('DocumentRelationship', back_populates='property')
    history = db.relationship('PropertyHistory', back_populates='property')
    
    __table_args__ = (
        db.UniqueConstraint('business_id', 'address_hash', name='uq_business_address_hash'),
    )
    
    def to_dict(self):
        """Convert property to dictionary with all relationships"""
        return {
            'id': str(self.id),
            'business_id': self.business_id,
            'normalized_address': self.normalized_address,
            'formatted_address': self.formatted_address,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'geocoding_status': self.geocoding_status,
            'geocoding_confidence': self.geocoding_confidence,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'last_enrichment_at': self.last_enrichment_at.isoformat() if self.last_enrichment_at else None,
            'completeness_score': self.completeness_score,
            'details': self.details.to_dict() if self.details else None,
            'document_count': len(self.documents) if self.documents else 0
        }

class PropertyDetails(db.Model):
    """Enriched property details from multiple documents"""
    __tablename__ = 'property_details'
    
    property_id = db.Column(UUID(as_uuid=True), db.ForeignKey('properties.id'), primary_key=True)
    property_type = db.Column(db.String(100))
    size_sqft = db.Column(db.Float)
    number_bedrooms = db.Column(db.Integer)
    number_bathrooms = db.Column(db.Integer)
    tenure = db.Column(db.String(50))
    epc_rating = db.Column(db.String(10))
    condition = db.Column(db.String(50))
    other_amenities = db.Column(db.Text)
    asking_price = db.Column(db.Float)
    sold_price = db.Column(db.Float)
    rent_pcm = db.Column(db.Float)
    last_transaction_date = db.Column(db.Date)
    last_valuation_date = db.Column(db.Date)
    data_sources = db.Column(JSONB)  # Array of document IDs that contributed to this data
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    property = db.relationship('Property', back_populates='details')
    
    def to_dict(self):
        """Convert property details to dictionary"""
        return {
            'property_id': str(self.property_id),
            'property_type': self.property_type,
            'size_sqft': self.size_sqft,
            'number_bedrooms': self.number_bedrooms,
            'number_bathrooms': self.number_bathrooms,
            'tenure': self.tenure,
            'epc_rating': self.epc_rating,
            'condition': self.condition,
            'other_amenities': self.other_amenities,
            'asking_price': self.asking_price,
            'sold_price': self.sold_price,
            'rent_pcm': self.rent_pcm,
            'last_transaction_date': self.last_transaction_date.isoformat() if self.last_transaction_date else None,
            'last_valuation_date': self.last_valuation_date.isoformat() if self.last_valuation_date else None,
            'data_sources': self.data_sources
        }

class DocumentRelationship(db.Model):
    """Links between documents and properties"""
    __tablename__ = 'document_relationships'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = db.Column(UUID(as_uuid=True), db.ForeignKey('documents.id'), nullable=False)
    property_id = db.Column(UUID(as_uuid=True), db.ForeignKey('properties.id'), nullable=False)
    relationship_type = db.Column(db.String(50), nullable=False)  # 'valuation', 'lease', 'offer', etc.
    address_source = db.Column(db.String(20), nullable=False)  # 'filename' or 'extraction'
    confidence_score = db.Column(db.Float)
    metadata = db.Column(JSONB)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    property = db.relationship('Property', back_populates='documents')
    document = db.relationship('Document', back_populates='properties')
    
    __table_args__ = (
        db.UniqueConstraint('document_id', 'property_id', name='uq_document_property_relationship'),
    )
    
    def to_dict(self):
        """Convert relationship to dictionary"""
        return {
            'id': str(self.id),
            'document_id': str(self.document_id),
            'property_id': str(self.property_id),
            'relationship_type': self.relationship_type,
            'address_source': self.address_source,
            'confidence_score': self.confidence_score,
            'metadata': self.metadata,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class PropertyHistory(db.Model):
    """Historical events for properties from documents"""
    __tablename__ = 'property_history'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    property_id = db.Column(UUID(as_uuid=True), db.ForeignKey('properties.id'), nullable=False)
    document_id = db.Column(UUID(as_uuid=True), db.ForeignKey('documents.id'), nullable=False)
    event_type = db.Column(db.String(50), nullable=False)  # 'valuation', 'sale', 'lease', etc.
    event_date = db.Column(db.Date, nullable=False)
    event_value = db.Column(db.Float)  # price/rent amount
    event_details = db.Column(JSONB)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    property = db.relationship('Property', back_populates='history')
    document = db.relationship('Document')
    
    def to_dict(self):
        """Convert history event to dictionary"""
        return {
            'id': str(self.id),
            'property_id': str(self.property_id),
            'document_id': str(self.document_id),
            'event_type': self.event_type,
            'event_date': self.event_date.isoformat() if self.event_date else None,
            'event_value': self.event_value,
            'event_details': self.event_details,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
