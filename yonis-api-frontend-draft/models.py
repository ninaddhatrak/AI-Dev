"""
Data Models for Telegram Harm Tracker
=====================================
Defines the core data structures for channels, messages, actors, and networks.
Privacy-by-design: minimizes personal data, uses pseudonymization where appropriate.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum
import hashlib
import json


class ChannelType(Enum):
    """Type of Telegram space"""
    CHANNEL = "channel"
    GROUP = "group"
    SUPERGROUP = "supergroup"
    UNKNOWN = "unknown"


class ContentFlag(Enum):
    """Content classification flags"""
    NUDIFY_TOOL = "nudify_tool"
    NUDIFY_SERVICE = "nudify_service"
    NUDIFY_OUTPUT = "nudify_output"
    PAYMENT_LINK = "payment_link"
    REFERRAL = "referral"
    TUTORIAL = "tutorial"
    PROMOTION = "promotion"
    CROSS_PROMOTION = "cross_promotion"
    UNKNOWN = "unknown"


class RiskLevel(Enum):
    """Risk classification for channels/content"""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNCLASSIFIED = "unclassified"


@dataclass
class Channel:
    """
    Represents a Telegram channel or group.
    Stores metadata only - no personal user data beyond public channel info.
    """
    channel_id: str  # Telegram channel/group ID (hashed for privacy)
    username: Optional[str]  # Public @username if available
    title: str
    channel_type: ChannelType
    description: Optional[str] = None
    
    # Metrics (public data only)
    member_count: Optional[int] = None
    message_count: Optional[int] = None
    
    # Discovery metadata
    discovered_at: datetime = field(default_factory=datetime.utcnow)
    discovery_method: str = "unknown"  # e.g., "keyword_search", "forward_trace", "tip"
    discovery_keywords: List[str] = field(default_factory=list)
    
    # Classification
    content_flags: List[ContentFlag] = field(default_factory=list)
    risk_level: RiskLevel = RiskLevel.UNCLASSIFIED
    
    # Network links
    invite_links: List[str] = field(default_factory=list)
    linked_channels: List[str] = field(default_factory=list)  # Channel IDs
    
    # Temporal tracking
    first_seen: datetime = field(default_factory=datetime.utcnow)
    last_seen: datetime = field(default_factory=datetime.utcnow)
    last_activity: Optional[datetime] = None
    
    # Status
    is_active: bool = True
    is_indexed: bool = False

    # Relevance scoring (topic-drift gating)
    relevance_score: Optional[float] = None  # 0.0–1.0; None = not yet scored
    is_dead_end: bool = False                 # True = never expand from this channel

    # Raw metadata storage
    extra_metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary for storage"""
        return {
            "channel_id": self.channel_id,
            "username": self.username,
            "title": self.title,
            "channel_type": self.channel_type.value,
            "description": self.description,
            "member_count": self.member_count,
            "message_count": self.message_count,
            "discovered_at": self.discovered_at.isoformat(),
            "discovery_method": self.discovery_method,
            "discovery_keywords": self.discovery_keywords,
            "content_flags": [f.value for f in self.content_flags],
            "risk_level": self.risk_level.value,
            "invite_links": self.invite_links,
            "linked_channels": self.linked_channels,
            "first_seen": self.first_seen.isoformat(),
            "last_seen": self.last_seen.isoformat(),
            "last_activity": self.last_activity.isoformat() if self.last_activity else None,
            "is_active": self.is_active,
            "is_indexed": self.is_indexed,
            "relevance_score": self.relevance_score,
            "is_dead_end": self.is_dead_end,
            "extra_metadata": self.extra_metadata
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Channel":
        """Deserialize from dictionary"""
        return cls(
            channel_id=data["channel_id"],
            username=data.get("username"),
            title=data["title"],
            channel_type=ChannelType(data.get("channel_type", "unknown")),
            description=data.get("description"),
            member_count=data.get("member_count"),
            message_count=data.get("message_count"),
            discovered_at=datetime.fromisoformat(data["discovered_at"]) if data.get("discovered_at") else datetime.utcnow(),
            discovery_method=data.get("discovery_method", "unknown"),
            discovery_keywords=data.get("discovery_keywords", []),
            content_flags=[ContentFlag(f) for f in data.get("content_flags", [])],
            risk_level=RiskLevel(data.get("risk_level", "unclassified")),
            invite_links=data.get("invite_links", []),
            linked_channels=data.get("linked_channels", []),
            first_seen=datetime.fromisoformat(data["first_seen"]) if data.get("first_seen") else datetime.utcnow(),
            last_seen=datetime.fromisoformat(data["last_seen"]) if data.get("last_seen") else datetime.utcnow(),
            last_activity=datetime.fromisoformat(data["last_activity"]) if data.get("last_activity") else None,
            is_active=data.get("is_active", True),
            is_indexed=data.get("is_indexed", False),
            relevance_score=data.get("relevance_score"),
            is_dead_end=data.get("is_dead_end", False),
            extra_metadata=data.get("extra_metadata", {})
        )


@dataclass
class Message:
    """
    Represents a Telegram message.
    Stores content metadata and signals - avoids storing exploitative media directly.
    """
    message_id: str  # Unique identifier (channel_id + msg_id)
    channel_id: str
    telegram_msg_id: int
    
    # Content (text only - no media storage)
    text: Optional[str] = None
    text_hash: Optional[str] = None  # For deduplication
    
    # Temporal
    timestamp: datetime = field(default_factory=datetime.utcnow)
    collected_at: datetime = field(default_factory=datetime.utcnow)
    
    # Forwarding/sharing metadata (key for network analysis)
    is_forwarded: bool = False
    forward_from_channel_id: Optional[str] = None
    forward_from_msg_id: Optional[int] = None
    
    # Extracted signals
    extracted_links: List[str] = field(default_factory=list)
    extracted_mentions: List[str] = field(default_factory=list)  # @usernames
    extracted_hashtags: List[str] = field(default_factory=list)
    
    # Media metadata (no actual media stored)
    has_media: bool = False
    media_type: Optional[str] = None  # "photo", "video", "document", etc.
    media_hash: Optional[str] = None  # Perceptual hash if computed
    
    # Classification
    content_flags: List[ContentFlag] = field(default_factory=list)
    keyword_matches: List[str] = field(default_factory=list)
    
    # Actor tracking (pseudonymized)
    sender_id_hash: Optional[str] = None  # Hashed sender ID
    
    # Processing status
    is_processed: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary for storage"""
        return {
            "message_id": self.message_id,
            "channel_id": self.channel_id,
            "telegram_msg_id": self.telegram_msg_id,
            "text": self.text,
            "text_hash": self.text_hash,
            "timestamp": self.timestamp.isoformat(),
            "collected_at": self.collected_at.isoformat(),
            "is_forwarded": self.is_forwarded,
            "forward_from_channel_id": self.forward_from_channel_id,
            "forward_from_msg_id": self.forward_from_msg_id,
            "extracted_links": self.extracted_links,
            "extracted_mentions": self.extracted_mentions,
            "extracted_hashtags": self.extracted_hashtags,
            "has_media": self.has_media,
            "media_type": self.media_type,
            "media_hash": self.media_hash,
            "content_flags": [f.value for f in self.content_flags],
            "keyword_matches": self.keyword_matches,
            "sender_id_hash": self.sender_id_hash,
            "is_processed": self.is_processed
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Message":
        """Deserialize from dictionary"""
        return cls(
            message_id=data["message_id"],
            channel_id=data["channel_id"],
            telegram_msg_id=data["telegram_msg_id"],
            text=data.get("text"),
            text_hash=data.get("text_hash"),
            timestamp=datetime.fromisoformat(data["timestamp"]) if data.get("timestamp") else datetime.utcnow(),
            collected_at=datetime.fromisoformat(data["collected_at"]) if data.get("collected_at") else datetime.utcnow(),
            is_forwarded=data.get("is_forwarded", False),
            forward_from_channel_id=data.get("forward_from_channel_id"),
            forward_from_msg_id=data.get("forward_from_msg_id"),
            extracted_links=data.get("extracted_links", []),
            extracted_mentions=data.get("extracted_mentions", []),
            extracted_hashtags=data.get("extracted_hashtags", []),
            has_media=data.get("has_media", False),
            media_type=data.get("media_type"),
            media_hash=data.get("media_hash"),
            content_flags=[ContentFlag(f) for f in data.get("content_flags", [])],
            keyword_matches=data.get("keyword_matches", []),
            sender_id_hash=data.get("sender_id_hash"),
            is_processed=data.get("is_processed", False)
        )


@dataclass
class Actor:
    """
    Represents a pseudonymized actor (poster/admin) across channels.
    Privacy-preserving: stores only hashed IDs and behavioral patterns.
    """
    actor_id: str  # Pseudonymized/hashed identifier
    
    # Activity patterns (no personal data)
    channels_active_in: List[str] = field(default_factory=list)
    first_seen: datetime = field(default_factory=datetime.utcnow)
    last_seen: datetime = field(default_factory=datetime.utcnow)
    message_count: int = 0
    
    # Behavioral signals
    posting_frequency: Optional[float] = None  # Messages per day
    typical_post_times: List[int] = field(default_factory=list)  # Hour of day
    content_flags: List[ContentFlag] = field(default_factory=list)
    
    # Network position
    cross_channel_posts: int = 0
    channels_administered: List[str] = field(default_factory=list)
    
    # Risk assessment
    risk_level: RiskLevel = RiskLevel.UNCLASSIFIED
    risk_signals: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary"""
        return {
            "actor_id": self.actor_id,
            "channels_active_in": self.channels_active_in,
            "first_seen": self.first_seen.isoformat(),
            "last_seen": self.last_seen.isoformat(),
            "message_count": self.message_count,
            "posting_frequency": self.posting_frequency,
            "typical_post_times": self.typical_post_times,
            "content_flags": [f.value for f in self.content_flags],
            "cross_channel_posts": self.cross_channel_posts,
            "channels_administered": self.channels_administered,
            "risk_level": self.risk_level.value,
            "risk_signals": self.risk_signals
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Actor":
        """Deserialize from dictionary"""
        return cls(
            actor_id=data["actor_id"],
            channels_active_in=data.get("channels_active_in", []),
            first_seen=datetime.fromisoformat(data["first_seen"]) if data.get("first_seen") else datetime.utcnow(),
            last_seen=datetime.fromisoformat(data["last_seen"]) if data.get("last_seen") else datetime.utcnow(),
            message_count=data.get("message_count", 0),
            posting_frequency=data.get("posting_frequency"),
            typical_post_times=data.get("typical_post_times", []),
            content_flags=[ContentFlag(f) for f in data.get("content_flags", [])],
            cross_channel_posts=data.get("cross_channel_posts", 0),
            channels_administered=data.get("channels_administered", []),
            risk_level=RiskLevel(data.get("risk_level", "unclassified")),
            risk_signals=data.get("risk_signals", [])
        )


@dataclass
class NetworkEdge:
    """
    Represents a connection between two channels in the network.
    Used for building propagation graphs.
    """
    edge_id: str
    source_channel_id: str
    target_channel_id: str
    edge_type: str  # "forward", "mention", "invite_link", "cross_post", "shared_admin"
    
    # Edge weight/strength
    weight: int = 1  # Number of interactions
    first_seen: datetime = field(default_factory=datetime.utcnow)
    last_seen: datetime = field(default_factory=datetime.utcnow)
    
    # Evidence
    sample_message_ids: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary"""
        return {
            "edge_id": self.edge_id,
            "source_channel_id": self.source_channel_id,
            "target_channel_id": self.target_channel_id,
            "edge_type": self.edge_type,
            "weight": self.weight,
            "first_seen": self.first_seen.isoformat(),
            "last_seen": self.last_seen.isoformat(),
            "sample_message_ids": self.sample_message_ids
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "NetworkEdge":
        """Deserialize from dictionary"""
        return cls(
            edge_id=data["edge_id"],
            source_channel_id=data["source_channel_id"],
            target_channel_id=data["target_channel_id"],
            edge_type=data["edge_type"],
            weight=data.get("weight", 1),
            first_seen=datetime.fromisoformat(data["first_seen"]) if data.get("first_seen") else datetime.utcnow(),
            last_seen=datetime.fromisoformat(data["last_seen"]) if data.get("last_seen") else datetime.utcnow(),
            sample_message_ids=data.get("sample_message_ids", [])
        )


@dataclass
class SeedKeyword:
    """
    Keywords used for discovery and classification.
    Tracks effectiveness and evolution of search terms.
    """
    keyword: str
    category: str  # e.g., "tool_name", "slang", "hashtag", "action"
    language: str = "en"
    
    # Effectiveness tracking
    channels_discovered: int = 0
    messages_matched: int = 0
    precision_estimate: Optional[float] = None
    
    # Status
    is_active: bool = True
    added_at: datetime = field(default_factory=datetime.utcnow)
    source: str = "manual"  # "manual", "boom_tip", "discovered"
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary"""
        return {
            "keyword": self.keyword,
            "category": self.category,
            "language": self.language,
            "channels_discovered": self.channels_discovered,
            "messages_matched": self.messages_matched,
            "precision_estimate": self.precision_estimate,
            "is_active": self.is_active,
            "added_at": self.added_at.isoformat(),
            "source": self.source
        }


# Utility functions for privacy-preserving operations

def hash_user_id(user_id: int, salt: str = "") -> str:
    """Create a pseudonymized hash of a user ID"""
    data = f"{user_id}{salt}".encode()
    return hashlib.sha256(data).hexdigest()[:16]


def hash_content(content: str) -> str:
    """Create a hash of content for deduplication"""
    return hashlib.sha256(content.encode()).hexdigest()


def create_message_id(channel_id: str, msg_id: int) -> str:
    """Create a unique message identifier"""
    return f"{channel_id}_{msg_id}"


def create_edge_id(source: str, target: str, edge_type: str) -> str:
    """Create a unique edge identifier"""
    return f"{source}_{target}_{edge_type}"
