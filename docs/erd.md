```mermaid
erDiagram

        CommunityType {
            Music Music
Applications Applications
EBooks EBooks
ELearningVideos ELearningVideos
Audiobooks Audiobooks
Comedy Comedy
Comics Comics
        }
    


        FileType {
            mp3 mp3
flac flac
wav wav
ogg ogg
aac aac
m4a m4a
m4b m4b
mp4 mp4
mkv mkv
avi avi
mov mov
zip zip
exe exe
dmg dmg
apk apk
pdf pdf
epub epub
mobi mobi
cbz cbz
cbr cbr
jpg jpg
png png
gif gif
txt txt
        }
    


        InviteStatus {
            pending pending
accepted accepted
rejected rejected
        }
    


        RegistrationStatus {
            open open
invite invite
closed closed
        }
    


        ReleaseType {
            Music Music
Applications Applications
EBooks EBooks
ELearningVideos ELearningVideos
Audiobooks Audiobooks
Comedy Comedy
Comics Comics
        }
    


        ReleaseCategory {
            Album Album
Single Single
EP EP
Anthology Anthology
Compilation Compilation
DJMix DJMix
Live Live
Remix Remix
Bootleg Bootleg
Interview Interview
Mixtape Mixtape
Demo Demo
ConcertRecording ConcertRecording
Unknown Unknown
        }
    


        CommentPage {
            artist artist
collages collages
contributions contributions
requests requests
communities communities
release release
        }
    


        SubscriptionPage {
            forums forums
artist artist
collages collages
requests requests
communities communities
contributions contributions
release release
news news
global_notices global_notices
        }
    


        NotificationType {
            forum_quote forum_quote
forum_sub forum_sub
request_filled request_filled
collage_updated collage_updated
comment_sub comment_sub
artist_release artist_release
site_news site_news
global_notice global_notice
rank_promoted rank_promoted
rank_demoted rank_demoted
        }
    


        RankExtraPredicate {
            DISTINCT_RELEASES_500 DISTINCT_RELEASES_500
QUALITY_CONTRIB_500 QUALITY_CONTRIB_500
        }
    


        ThreadType {
            forum forum
application application
        }
    


        ApiUserState {
            inactive inactive
active active
        }
    


        NoteVisibility {
            public public
staff staff
        }
    


        ForumRuleTarget {
            Forum Forum
Thread Thread
Topic Topic
        }
    


        RequestStatus {
            open open
filled filled
deleted deleted
        }
    


        NotificationMethod {
            Disabled Disabled
Popup Popup
Traditional Traditional
Push Push
Combined Combined
        }
    


        EconomyTransactionReason {
            REQUEST_CREATE REQUEST_CREATE
REQUEST_VOTE REQUEST_VOTE
REQUEST_FILL REQUEST_FILL
REQUEST_UNFILL REQUEST_UNFILL
REQUEST_REFUND REQUEST_REFUND
DOWNLOAD_DEBIT DOWNLOAD_DEBIT
DOWNLOAD_CREDIT DOWNLOAD_CREDIT
STAFF_REVERSAL STAFF_REVERSAL
CRS_STYLESHEET_ADOPTION CRS_STYLESHEET_ADOPTION
        }
    


        DownloadGrantStatus {
            COMPLETED COMPLETED
REVERSED REVERSED
        }
    


        RatioPolicyStatus {
            OK OK
WATCH WATCH
LEECH_DISABLED LEECH_DISABLED
        }
    


        LinkHealthStatus {
            UNKNOWN UNKNOWN
PASS PASS
WARN WARN
FAIL FAIL
        }
    


        RequestActionType {
            CREATE CREATE
ADD_BOUNTY ADD_BOUNTY
FILL FILL
UNFILL UNFILL
DELETE DELETE
RESTORE RESTORE
        }
    


        StaffInboxStatus {
            Unanswered Unanswered
Open Open
Resolved Resolved
        }
    


        ReportStatus {
            Open Open
Claimed Claimed
Resolved Resolved
        }
    


        ReportTargetType {
            User User
Release Release
Artist Artist
Contribution Contribution
ForumTopic ForumTopic
ForumPost ForumPost
Comment Comment
Collage Collage
Post Post
        }
    


        ReportResolutionAction {
            Dismissed Dismissed
ContentRemoved ContentRemoved
UserWarned UserWarned
UserDisabled UserDisabled
MetadataFixed MetadataFixed
MarkedDuplicate MarkedDuplicate
Other Other
        }
    


        ReleaseReportCategory {
            Dupe Dupe
Trump Trump
BadFileNamesTrump BadFileNamesTrump
BadFolderNameTrump BadFolderNameTrump
TagTrump TagTrump
VinylTrump VinylTrump
AudienceRecording AudienceRecording
BadFileNames BadFileNames
BadFolderNames BadFolderNames
BadTagNoTag BadTagNoTag
BonusTracksOnly BonusTracksOnly
DisallowedFormat DisallowedFormat
DiscsMissing DiscsMissing
Discography Discography
MqaBanned MqaBanned
EditedLog EditedLog
InaccurateBitrate InaccurateBitrate
LogRescoreRequest LogRescoreRequest
LossyMasterApprovalRequest LossyMasterApprovalRequest
ContributionContestApprovalRequest ContributionContestApprovalRequest
LowBitrate LowBitrate
MuttRip MuttRip
NoLineageInfo NoLineageInfo
Other Other
RadioTvFmWebRip RadioTvFmWebRip
SkipsEncodeErrors SkipsEncodeErrors
SpecificallyBanned SpecificallyBanned
TracksMissing TracksMissing
Transcode Transcode
UnsplitAlbumRip UnsplitAlbumRip
Urgent Urgent
UserCompilation UserCompilation
WrongSpecifiedFormat WrongSpecifiedFormat
WrongSpecifiedMedia WrongSpecifiedMedia
        }
    


        FriendStatus {
            pending pending
accepted accepted
rejected rejected
        }
    


        ReleaseTagVoteDirection {
            up up
down down
        }
    


        ArtistRole {
            Main Main
Guest Guest
Composer Composer
Conductor Conductor
DJ DJ
Remixer Remixer
Producer Producer
Arranger Arranger
        }
    


        Bitrate {
            Lossless Lossless
Lossless24 Lossless24
Kbps320 Kbps320
Kbps256 Kbps256
KbpsV0 KbpsV0
Kbps192 Kbps192
KbpsV2 KbpsV2
Kbps128 Kbps128
Other Other
        }
    


        ReleaseMedia {
            CD CD
WEB WEB
Vinyl Vinyl
SACD SACD
DVD DVD
Cassette Cassette
BluRay BluRay
DAT DAT
Soundboard Soundboard
Other Other
        }
    


        ReleaseHistoryAction {
            created created
edit edit
tag_added tag_added
tag_removed tag_removed
contribution_added contribution_added
        }
    


        Top10SnapshotType {
            Daily Daily
Weekly Weekly
        }
    


        StatSnapshotPeriod {
            Daily Daily
Monthly Monthly
Yearly Yearly
        }
    
  "staff_groups" {
    Int id "🗝️"
    Int sortOrder 
    String name 
    }
  

  "user_ranks" {
    Int id "🗝️"
    Int level 
    String name 
    Json permissions 
    Boolean secondary 
    Int permittedForumIds 
    String color 
    String badge 
    Int uploadRequired 
    Int personalCollageLimit 
    Boolean displayStaff 
    }
  

  "rank_promotion_rules" {
    Int id "🗝️"
    BigInt minContributed 
    Float minRatio 
    Int minContributions 
    Int minAccountAgeDays 
    RankExtraPredicate extra "❓"
    Boolean enabled 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "user_settings" {
    Int id "🗝️"
    String siteAppearance 
    String externalStylesheet "❓"
    Boolean styledTooltips 
    Int paranoia 
    NotificationMethod notificationMethod 
    Boolean showEmail 
    Boolean showLastSeen 
    Boolean showContributedStats 
    Boolean showConsumedStats 
    Boolean showRatioStats 
    }
  

  "users" {
    Int id "🗝️"
    String username 
    String email 
    String password 
    String avatar "❓"
    Int inviteCount 
    BigInt contributed 
    BigInt consumed 
    BigInt totalEarned 
    Float ratio 
    Int ratioWatchDownload "❓"
    DateTime lastLogin "❓"
    DateTime dateRegistered 
    Boolean disabled 
    Boolean isArtist 
    Boolean isDonor 
    Boolean canDownload 
    Boolean rankLocked 
    String adminComment "❓"
    String staffBio "❓"
    DateTime banDate "❓"
    String banReason "❓"
    DateTime warned "❓"
    Int warnedTimes 
    String lastIp "❓"
    Boolean disablePm 
    String ircNick "❓"
    String pendingIrcNick "❓"
    String ircNickNonce "❓"
    DateTime ircNickNonceExpiresAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "user_secondary_ranks" {
    DateTime createdAt 
    }
  

  "invites" {
    Int id "🗝️"
    String inviteKey 
    String email 
    DateTime expires 
    String reason 
    InviteStatus status 
    }
  

  "invite_trees" {
    Int id "🗝️"
    DateTime createdAt 
    }
  

  "friend_relationships" {
    Int id "🗝️"
    FriendStatus status 
    String comment 
    DateTime createdAt 
    }
  

  "profiles" {
    Int id "🗝️"
    String avatar "❓"
    String avatarMouseoverText "❓"
    String profileTitle "❓"
    String profileInfo "❓"
    }
  

  "stylesheets" {
    Int id "🗝️"
    String name 
    String description 
    String cssUrl 
    Boolean isDefault 
    DateTime createdAt 
    }
  

  "author_stylesheets" {
    Int id "🗝️"
    String name 
    String source 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "forum_categories" {
    Int id "🗝️"
    String name 
    Int sort 
    }
  

  "forums" {
    Int id "🗝️"
    Int sort 
    String name 
    String description 
    Int minClassRead 
    Int minClassWrite 
    Int minClassCreate 
    Int numTopics 
    Int numPosts 
    Boolean autoLock 
    Int autoLockWeeks 
    Boolean isTrash 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "forum_topics" {
    Int id "🗝️"
    String title 
    Boolean isLocked 
    Boolean isSticky 
    Int ranking 
    Int numPosts 
    DateTime createdAt 
    DateTime updatedAt 
    DateTime deletedAt "❓"
    }
  

  "forum_posts" {
    Int id "🗝️"
    String body 
    DateTime createdAt 
    DateTime updatedAt 
    DateTime deletedAt "❓"
    }
  

  "forum_post_edits" {
    Int id "🗝️"
    String previousBody 
    DateTime editedAt 
    }
  

  "forum_polls" {
    Int id "🗝️"
    String question 
    String answers 
    DateTime featured "❓"
    Boolean closed 
    }
  

  "forum_poll_votes" {
    Int id "🗝️"
    Int userId 
    Int vote 
    }
  

  "forum_last_read_topics" {
    Int id "🗝️"
    Int userId 
    }
  

  "forum_topic_notes" {
    Int id "🗝️"
    String body 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "forum_specific_rules" {
    Int id "🗝️"
    ForumRuleTarget targetType 
    }
  

  "threads" {
    Int id "🗝️"
    ThreadType type 
    DateTime createdAt 
    }
  

  "artists" {
    Int id "🗝️"
    String name 
    Boolean vanityHouse 
    }
  

  "artist_histories" {
    Int id "🗝️"
    Json data 
    DateTime editedAt 
    String description "❓"
    }
  

  "artist_aliases" {
    Int id "🗝️"
    Int userId "❓"
    }
  

  "artist_tags" {
    Int id "🗝️"
    Int positiveVotes 
    Int negativeVotes 
    Int userId "❓"
    }
  

  "release_tags" {
    Int id "🗝️"
    Int positiveVotes 
    Int negativeVotes 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "release_tag_votes" {
    Int id "🗝️"
    ReleaseTagVoteDirection direction 
    DateTime createdAt 
    }
  

  "artist_subscriptions" {
    Int id "🗝️"
    DateTime createdAt 
    }
  

  "concerts" {
    Int id "🗝️"
    }
  

  "similar_artists" {
    Int id "🗝️"
    Int score 
    Json votes 
    }
  

  "communities" {
    Int id "🗝️"
    String name 
    String description "❓"
    String image 
    RegistrationStatus registrationStatus 
    CommunityType type 
    Boolean allowDuplicateFormats 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "consumers" {
    Int id "🗝️"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "contributors" {
    Int id "🗝️"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "releases" {
    Int id "🗝️"
    String title 
    String image "❓"
    String description 
    ReleaseType type 
    ReleaseCategory releaseType 
    Int year 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "contributions" {
    Int id "🗝️"
    String releaseDescription "❓"
    String downloadUrl 
    BigInt sizeInBytes "❓"
    BigInt approvedAccountingBytes "❓"
    LinkHealthStatus linkStatus 
    DateTime linkCheckedAt "❓"
    DateTime linkStatusChangedAt "❓"
    FileType type 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "release_files" {
    Int id "🗝️"
    Bitrate bitrate "❓"
    Boolean hasLog 
    Boolean hasCue 
    Boolean isScene 
    }
  

  "release_artists" {
    Int id "🗝️"
    ArtistRole role 
    }
  

  "editions" {
    Int id "🗝️"
    String title "❓"
    Int year "❓"
    String recordLabel "❓"
    String catalogueNumber "❓"
    ReleaseMedia media "❓"
    Boolean isRemaster 
    Boolean isUnknownEdition 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "do_not_contribute" {
    Int id "🗝️"
    String name 
    String comment 
    Int userId 
    DateTime createdAt 
    }
  

  "comments" {
    Int id "🗝️"
    CommentPage page 
    String body 
    DateTime editedAt "❓"
    DateTime createdAt 
    DateTime deletedAt "❓"
    }
  

  "donations" {
    Int id "🗝️"
    Float amount 
    String email 
    DateTime donatedAt 
    String currency 
    String source 
    String reason 
    Int rank 
    Int addedBy 
    Int totalRank 
    }
  

  "bitcoin_donations" {
    Int id "🗝️"
    String bitcoinAddress 
    Float amount 
    }
  

  "donor_forum_usernames" {
    Int id "🗝️"
    String prefix 
    String suffix 
    Boolean useComma 
    }
  

  "donor_rewards" {
    Int id "🗝️"
    String iconMouseOverText 
    String avatarMouseOverText 
    String customIcon 
    String secondAvatar 
    String customIconLink 
    String profileInfo1 
    String profileInfo2 
    String profileInfo3 
    String profileInfo4 
    String profileInfoTitle1 
    String profileInfoTitle2 
    String profileInfoTitle3 
    String profileInfoTitle4 
    }
  

  "collages" {
    Int id "🗝️"
    String name 
    String description 
    Int categoryId 
    String tags 
    Boolean isLocked 
    Boolean isDeleted 
    Int maxEntries 
    Int maxEntriesPerUser 
    Boolean isFeatured 
    Int numEntries 
    Int numSubscribers 
    DateTime createdAt 
    DateTime updatedAt 
    DateTime deletedAt "❓"
    }
  

  "collage_entries" {
    Int id "🗝️"
    Int sort 
    DateTime addedAt 
    }
  

  "collage_subscriptions" {
    Int id "🗝️"
    DateTime lastVisit 
    }
  

  "bookmark_artists" {
    Int id "🗝️"
    DateTime createdAt 
    }
  

  "bookmark_collages" {
    Int id "🗝️"
    DateTime createdAt 
    }
  

  "bookmark_releases" {
    Int id "🗝️"
    Int sort 
    DateTime createdAt 
    }
  

  "bookmark_communities" {
    Int id "🗝️"
    Int sort 
    DateTime createdAt 
    }
  

  "bookmark_requests" {
    Int id "🗝️"
    DateTime createdAt 
    }
  

  "requests" {
    Int id "🗝️"
    String title 
    String description 
    ReleaseType type 
    Int year "❓"
    String image "❓"
    RequestStatus status 
    DateTime filledAt "❓"
    Int voteCount 
    DateTime createdAt 
    DateTime updatedAt 
    DateTime deletedAt "❓"
    }
  

  "request_bounties" {
    Int id "🗝️"
    BigInt amount 
    DateTime createdAt 
    }
  

  "request_artists" {
    Int id "🗝️"
    }
  

  "economy_transactions" {
    Int id "🗝️"
    BigInt amount 
    EconomyTransactionReason reason 
    Int contextId "❓"
    String contextType "❓"
    DateTime createdAt 
    }
  

  "request_actions" {
    Int id "🗝️"
    RequestActionType action 
    Json metadata "❓"
    DateTime createdAt 
    }
  

  "request_fills" {
    Int id "🗝️"
    BigInt awardedAmount 
    DateTime createdAt 
    }
  

  "download_access_grants" {
    Int id "🗝️"
    BigInt amountBytes 
    DownloadGrantStatus status 
    String idempotencyKey "❓"
    DateTime reversedAt "❓"
    String reversalReason "❓"
    DateTime createdAt 
    }
  

  "ratio_policy_states" {
    RatioPolicyStatus status 
    DateTime watchStartedAt "❓"
    DateTime watchExpiresAt "❓"
    BigInt consumedAtWatchStart "❓"
    DateTime leechDisabledAt "❓"
    DateTime lastEvaluatedAt 
    }
  

  "contribution_reports" {
    Int id "🗝️"
    String reason 
    DateTime createdAt 
    }
  

  "blogs" {
    Int id "🗝️"
    String title 
    String body 
    Int threadId "❓"
    Boolean important 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "contest_types" {
    Int id "🗝️"
    String name 
    }
  

  "cover_art" {
    Int id "🗝️"
    Int groupId 
    String image 
    String summary "❓"
    Int userId 
    DateTime addedAt "❓"
    }
  

  "featured_albums" {
    Int id "🗝️"
    Int groupId 
    Int threadId 
    String title 
    String image 
    DateTime started 
    DateTime ended 
    }
  

  "featured_merch" {
    Int id "🗝️"
    Int productId 
    String title 
    String image 
    DateTime started 
    DateTime ended 
    Int artistId 
    }
  

  "subscriptions" {
    Int id "🗝️"
    Int topicId 
    }
  

  "comment_subscriptions" {
    Int id "🗝️"
    SubscriptionPage page 
    Int pageId 
    }
  

  "notifications" {
    Int id "🗝️"
    NotificationType type 
    SubscriptionPage page 
    Int pageId 
    Int postId "❓"
    DateTime readAt "❓"
    DateTime createdAt 
    }
  

  "tags" {
    Int id "🗝️"
    String name 
    Int occurrences 
    }
  

  "tag_aliases" {
    Int id "🗝️"
    String badTag 
    DateTime createdAt 
    }
  

  "release_histories" {
    Int id "🗝️"
    ReleaseHistoryAction action 
    String summary 
    String changedFields 
    Json before "❓"
    Json after "❓"
    Json snapshot "❓"
    DateTime createdAt 
    }
  

  "posts" {
    Int id "🗝️"
    String title 
    String text 
    String category 
    String tags 
    DateTime createdAt 
    }
  

  "post_comments" {
    Int id "🗝️"
    String text 
    DateTime createdAt 
    }
  

  "news" {
    Int id "🗝️"
    String title 
    String body 
    DateTime createdAt 
    }
  

  "global_notices" {
    Int id "🗝️"
    String message 
    String url "❓"
    DateTime expiresAt "❓"
    DateTime createdAt 
    }
  

  "applicants" {
    Int id "🗝️"
    String roleId 
    Boolean resolved 
    String body "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "notes" {
    Int id "🗝️"
    String text 
    NoteVisibility visibility 
    DateTime createdAt 
    }
  

  "api_applications" {
    Int id "🗝️"
    String token 
    String name 
    }
  

  "api_users" {
    Int id "🗝️"
    String token 
    ApiUserState state 
    String access 
    DateTime createdAt 
    }
  

  "bad_passwords" {
    Int id "🗝️"
    String password 
    }
  

  "currency_conversion_rates" {
    Int id "🗝️"
    String currency 
    Float rate "❓"
    DateTime updatedAt "❓"
    }
  

  "email_blacklists" {
    Int id "🗝️"
    Int userId 
    String email 
    DateTime addedAt 
    String comment 
    }
  

  "ip_bans" {
    Int id "🗝️"
    Int fromIp 
    Int toIp 
    }
  

  "group_logs" {
    Int id "🗝️"
    Int groupId 
    Int communityId 
    Int userId 
    String info "❓"
    DateTime loggedAt 
    Int hidden 
    }
  

  "audit_logs" {
    Int id "🗝️"
    String action 
    String targetType 
    Int targetId "❓"
    Json metadata "❓"
    DateTime createdAt 
    }
  

  "private_conversations" {
    Int id "🗝️"
    String subject 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "private_conversation_participants" {
    Boolean inInbox 
    Boolean inSentbox 
    Boolean isRead 
    Boolean isSticky 
    Int forwardedToId "❓"
    DateTime sentAt "❓"
    DateTime receivedAt "❓"
    }
  

  "private_messages" {
    Int id "🗝️"
    String body 
    DateTime createdAt 
    }
  

  "staff_inbox_conversations" {
    Int id "🗝️"
    String subject 
    StaffInboxStatus status 
    Boolean isReadByUser 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "staff_inbox_messages" {
    Int id "🗝️"
    String body 
    DateTime createdAt 
    }
  

  "staff_inbox_responses" {
    Int id "🗝️"
    String name 
    String body 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "reports" {
    Int id "🗝️"
    ReportTargetType targetType 
    Int targetId 
    String category 
    ReleaseReportCategory releaseCategory "❓"
    String reason 
    String evidence "❓"
    ReportStatus status 
    DateTime claimedAt "❓"
    DateTime resolvedAt "❓"
    String resolution "❓"
    ReportResolutionAction resolutionAction "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "report_notes" {
    Int id "🗝️"
    String body 
    DateTime createdAt 
    }
  

  "site_settings" {
    Int id "🗝️"
    String approvedDomains 
    RegistrationStatus registrationStatus 
    Int maxUsers 
    String dismissedLaunchChecklist 
    DateTime updatedAt 
    }
  

  "user_sessions" {
    String id "🗝️"
    String ipAddress 
    String userAgent "❓"
    DateTime createdAt 
    DateTime lastActiveAt 
    DateTime revokedAt "❓"
    }
  

  "account_recoveries" {
    Int id "🗝️"
    String token 
    DateTime expiresAt 
    DateTime usedAt "❓"
    DateTime createdAt 
    }
  

  "user_email_histories" {
    Int id "🗝️"
    String oldEmail 
    String newEmail 
    DateTime changedAt 
    String ipAddress "❓"
    }
  

  "user_warnings" {
    Int id "🗝️"
    String reason 
    DateTime expiresAt "❓"
    DateTime createdAt 
    }
  

  "user_moderation_notes" {
    Int id "🗝️"
    String body 
    DateTime createdAt 
    }
  

  "donor_ranks" {
    Int id "🗝️"
    String name 
    Float minDonation 
    Int expiresAfterDays "❓"
    Json perks 
    String color 
    String badge 
    }
  

  "user_donor_ranks" {
    Int id "🗝️"
    DateTime grantedAt 
    DateTime expiresAt "❓"
    Int grantedById "❓"
    }
  

  "request_votes" {
    Int id "🗝️"
    DateTime createdAt 
    }
  

  "pm_drafts" {
    Int id "🗝️"
    Int toUserId "❓"
    String subject 
    String body 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "mass_messages" {
    Int id "🗝️"
    String subject 
    String body 
    Int sentCount 
    DateTime createdAt 
    }
  

  "site_history" {
    Int id "🗝️"
    String title 
    String body 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "wiki_pages" {
    Int id "🗝️"
    String title 
    String body 
    String slug 
    Int revision 
    Int minReadLevel 
    Int minEditLevel 
    DateTime createdAt 
    DateTime updatedAt 
    DateTime deletedAt "❓"
    }
  

  "wiki_revisions" {
    Int id "🗝️"
    Int revision 
    String title 
    String body 
    DateTime createdAt 
    }
  

  "wiki_aliases" {
    String alias "🗝️"
    DateTime createdAt 
    }
  

  "rules_pages" {
    Int id "🗝️"
    String slug 
    String title 
    String body 
    Boolean isMain 
    Int sortOrder 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "rules" {
    Int id "🗝️"
    String code 
    String title 
    String description 
    Float complianceWeight 
    Float violationWeight 
    Int sortOrder 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "sub_rules" {
    Int id "🗝️"
    String code 
    String title 
    String description 
    Float complianceWeight 
    Float violationWeight 
    Int sortOrder 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "release_votes" {
    Int id "🗝️"
    Boolean positive 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "release_vote_aggregates" {
    Int id "🗝️"
    Int ups 
    Int total 
    Float score 
    DateTime updatedAt 
    }
  

  "top10_snapshots" {
    Int id "🗝️"
    Top10SnapshotType type 
    DateTime createdAt 
    }
  

  "top10_snapshot_entries" {
    Int id "🗝️"
    Int rank 
    String releaseTitle 
    String tagString 
    }
  

  "user_stat_snapshots" {
    Int id "🗝️"
    StatSnapshotPeriod period 
    DateTime bucketAt 
    DateTime capturedAt 
    BigInt contributed 
    BigInt consumed 
    Int contributionCount 
    }
  

  "site_stat_snapshots" {
    Int id "🗝️"
    DateTime bucketAt 
    DateTime capturedAt 
    Int maxUsers 
    Int totalUsers 
    Int enabledUsers 
    Int activeToday 
    Int activeThisWeek 
    Int activeThisMonth 
    Int communities 
    Int releases 
    Int artists 
    Int blogPosts 
    Int announcements 
    Int comments 
    Int contributedLinks 
    Int contributedLinkDownloads 
    }
  

  "community_health_snapshots" {
    Int id "🗝️"
    StatSnapshotPeriod period 
    DateTime bucketAt 
    DateTime capturedAt 
    Int pass 
    Int warn 
    Int fail 
    Int unknown 
    Int total 
    Int checked 
    Float coverage "❓"
    Float pulse "❓"
    String status 
    }
  

  "crs_snapshots" {
    Int id "🗝️"
    StatSnapshotPeriod period 
    DateTime bucketAt 
    DateTime capturedAt 
    Float score 
    Json dimensions 
    }
  

  "dev_seed_runs" {
    String id "🗝️"
    String label "❓"
    String mode 
    Json config 
    Json summary 
    Json warnings "❓"
    String cleanupStatus 
    String reversibilityLevel 
    Int actorId 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "dev_seed_records" {
    String id "🗝️"
    String entityType 
    Json pk 
    DateTime createdAt 
    }
  

  "dev_seed_mutations" {
    String id "🗝️"
    String entityType 
    Json pk 
    String mutation 
    Json before "❓"
    Json after "❓"
    Boolean reversible 
    DateTime createdAt 
    }
  
    "user_ranks" }o--|o staff_groups : "staffGroup"
    "rank_promotion_rules" }o--|| user_ranks : "fromRank"
    "rank_promotion_rules" }o--|| user_ranks : "toRank"
    "rank_promotion_rules" |o--|o "RankExtraPredicate" : "enum:extra"
    "user_settings" |o--|| "NotificationMethod" : "enum:notificationMethod"
    "user_settings" }o--|o author_stylesheets : "activeAuthorStylesheet"
    "users" }o--|| user_ranks : "userRank"
    "users" |o--|| user_settings : "userSettings"
    "users" |o--|| profiles : "profile"
    "users" o{--}o "communities" : ""
    "user_secondary_ranks" }o--|| users : "user"
    "user_secondary_ranks" }o--|| user_ranks : "userRank"
    "user_secondary_ranks" }o--|o users : "assignedBy"
    "invites" }o--|| users : "inviter"
    "invites" |o--|| "InviteStatus" : "enum:status"
    "invite_trees" |o--|| users : "user"
    "invite_trees" }o--|o users : "inviter"
    "friend_relationships" }o--|| users : "requester"
    "friend_relationships" }o--|| users : "recipient"
    "friend_relationships" |o--|| "FriendStatus" : "enum:status"
    "author_stylesheets" }o--|| users : "author"
    "forums" }o--|| forum_categories : "forumCategory"
    "forums" }o--|o forum_topics : "lastTopic"
    "forum_topics" }o--|| forums : "forum"
    "forum_topics" }o--|o threads : "thread"
    "forum_topics" }o--|| users : "author"
    "forum_topics" }o--|o forum_posts : "lastPost"
    "forum_posts" }o--|| forum_topics : "forumTopic"
    "forum_posts" }o--|| users : "author"
    "forum_post_edits" }o--|| forum_posts : "forumPost"
    "forum_post_edits" }o--|| users : "editor"
    "forum_polls" |o--|| forum_topics : "forumTopic"
    "forum_poll_votes" }o--|| forum_polls : "forumPoll"
    "forum_last_read_topics" }o--|| forum_topics : "forumTopic"
    "forum_last_read_topics" }o--|| forum_posts : "forumPost"
    "forum_topic_notes" }o--|| forum_topics : "forumTopic"
    "forum_topic_notes" }o--|| users : "author"
    "forum_specific_rules" |o--|| "ForumRuleTarget" : "enum:targetType"
    "forum_specific_rules" }o--|o forums : "forum"
    "forum_specific_rules" }o--|o threads : "thread"
    "forum_specific_rules" }o--|o forum_topics : "forumTopic"
    "threads" |o--|| "ThreadType" : "enum:type"
    "artists" o{--}o "contributions" : ""
    "artist_histories" }o--|| artists : "artist"
    "artist_histories" }o--|| users : "editedUser"
    "artist_aliases" }o--|| artists : "artist"
    "artist_aliases" }o--|| artists : "redirect"
    "artist_tags" }o--|| artists : "artist"
    "artist_tags" }o--|| tags : "tag"
    "release_tags" }o--|| releases : "release"
    "release_tags" }o--|| tags : "tag"
    "release_tags" }o--|o users : "user"
    "release_tag_votes" }o--|| release_tags : "releaseTag"
    "release_tag_votes" }o--|| users : "user"
    "release_tag_votes" |o--|| "ReleaseTagVoteDirection" : "enum:direction"
    "artist_subscriptions" }o--|| users : "user"
    "artist_subscriptions" }o--|| artists : "artist"
    "concerts" }o--|| artists : "artist"
    "concerts" |o--|| forum_topics : "forumTopic"
    "similar_artists" }o--|| artists : "artist"
    "similar_artists" }o--|| artists : "similarArtist"
    "communities" |o--|| "RegistrationStatus" : "enum:registrationStatus"
    "communities" |o--|| "CommunityType" : "enum:type"
    "communities" o{--}o "consumers" : ""
    "consumers" |o--|| users : "user"
    "consumers" o{--}o "releases" : ""
    "consumers" o{--}o "contributions" : ""
    "contributors" |o--|| users : "user"
    "contributors" }o--|| communities : "community"
    "contributors" o{--}o "releases" : ""
    "releases" }o--|o communities : "community"
    "releases" |o--|| "ReleaseType" : "enum:type"
    "releases" |o--|| "ReleaseCategory" : "enum:releaseType"
    "contributions" }o--|| users : "user"
    "contributions" }o--|| releases : "release"
    "contributions" }o--|| contributors : "contributor"
    "contributions" |o--|| "LinkHealthStatus" : "enum:linkStatus"
    "contributions" |o--|| "FileType" : "enum:type"
    "contributions" }o--|| editions : "edition"
    "release_files" |o--|| contributions : "contribution"
    "release_files" |o--|o "Bitrate" : "enum:bitrate"
    "release_artists" }o--|| releases : "release"
    "release_artists" }o--|| artists : "artist"
    "release_artists" |o--|| "ArtistRole" : "enum:role"
    "editions" }o--|| releases : "release"
    "editions" |o--|o "ReleaseMedia" : "enum:media"
    "do_not_contribute" }o--|| communities : "community"
    "comments" |o--|| "CommentPage" : "enum:page"
    "comments" }o--|| users : "author"
    "comments" }o--|o users : "editedUser"
    "comments" }o--|o artists : "artist"
    "comments" }o--|o communities : "community"
    "comments" }o--|o contributions : "contribution"
    "comments" }o--|o requests : "request"
    "comments" }o--|o releases : "release"
    "comments" }o--|o collages : "collage"
    "donations" }o--|| users : "user"
    "donor_forum_usernames" |o--|| users : "user"
    "donor_rewards" |o--|| users : "user"
    "collages" }o--|| users : "user"
    "collage_entries" }o--|| collages : "collage"
    "collage_entries" }o--|| releases : "release"
    "collage_entries" }o--|| users : "user"
    "collage_subscriptions" }o--|| users : "user"
    "collage_subscriptions" }o--|| collages : "collage"
    "bookmark_artists" }o--|| users : "user"
    "bookmark_artists" }o--|| artists : "artist"
    "bookmark_collages" }o--|| users : "user"
    "bookmark_collages" }o--|| collages : "collage"
    "bookmark_releases" }o--|| users : "user"
    "bookmark_releases" }o--|| releases : "release"
    "bookmark_communities" }o--|| users : "user"
    "bookmark_communities" }o--|| communities : "community"
    "bookmark_requests" }o--|| users : "user"
    "bookmark_requests" }o--|| requests : "request"
    "requests" }o--|| communities : "community"
    "requests" }o--|| users : "user"
    "requests" |o--|| "ReleaseType" : "enum:type"
    "requests" |o--|| "RequestStatus" : "enum:status"
    "requests" }o--|o users : "filler"
    "requests" }o--|o contributions : "filledContribution"
    "request_bounties" }o--|| requests : "request"
    "request_bounties" }o--|| users : "user"
    "request_artists" }o--|| requests : "request"
    "request_artists" }o--|| artists : "artist"
    "economy_transactions" }o--|| users : "user"
    "economy_transactions" |o--|| "EconomyTransactionReason" : "enum:reason"
    "economy_transactions" }o--|o users : "actor"
    "request_actions" }o--|| requests : "request"
    "request_actions" }o--|| users : "actor"
    "request_actions" |o--|| "RequestActionType" : "enum:action"
    "request_fills" }o--|| requests : "request"
    "request_fills" }o--|| contributions : "contribution"
    "request_fills" }o--|| users : "filler"
    "download_access_grants" }o--|| users : "consumer"
    "download_access_grants" }o--|| users : "contributor"
    "download_access_grants" }o--|| contributions : "contribution"
    "download_access_grants" |o--|| "DownloadGrantStatus" : "enum:status"
    "download_access_grants" }o--|o users : "reversedBy"
    "ratio_policy_states" |o--|| users : "user"
    "ratio_policy_states" |o--|| "RatioPolicyStatus" : "enum:status"
    "contribution_reports" }o--|| contributions : "contribution"
    "contribution_reports" }o--|| users : "reporter"
    "blogs" }o--|| users : "user"
    "subscriptions" }o--|| users : "user"
    "comment_subscriptions" }o--|| users : "user"
    "comment_subscriptions" |o--|| "SubscriptionPage" : "enum:page"
    "notifications" }o--|| users : "user"
    "notifications" |o--|| "NotificationType" : "enum:type"
    "notifications" }o--|o users : "actor"
    "notifications" |o--|| "SubscriptionPage" : "enum:page"
    "tag_aliases" }o--|| tags : "goodTag"
    "tag_aliases" }o--|| users : "createdBy"
    "release_histories" }o--|| releases : "release"
    "release_histories" }o--|| users : "actor"
    "release_histories" |o--|| "ReleaseHistoryAction" : "enum:action"
    "posts" }o--|| users : "user"
    "post_comments" }o--|| posts : "post"
    "post_comments" }o--|| users : "user"
    "global_notices" }o--|| users : "createdBy"
    "applicants" }o--|| users : "user"
    "applicants" }o--|| threads : "thread"
    "notes" }o--|| threads : "thread"
    "notes" }o--|| users : "user"
    "notes" |o--|| "NoteVisibility" : "enum:visibility"
    "api_applications" }o--|| users : "user"
    "api_users" }o--|| users : "user"
    "api_users" }o--|| api_applications : "apiApplication"
    "api_users" |o--|| "ApiUserState" : "enum:state"
    "audit_logs" }o--|| users : "actor"
    "private_conversation_participants" }o--|| users : "user"
    "private_conversation_participants" }o--|| private_conversations : "conversation"
    "private_messages" }o--|| private_conversations : "conversation"
    "private_messages" }o--|o users : "sender"
    "staff_inbox_conversations" }o--|| users : "user"
    "staff_inbox_conversations" |o--|| "StaffInboxStatus" : "enum:status"
    "staff_inbox_conversations" }o--|o users : "assignedUser"
    "staff_inbox_conversations" }o--|o users : "resolver"
    "staff_inbox_messages" }o--|| staff_inbox_conversations : "conversation"
    "staff_inbox_messages" }o--|| users : "sender"
    "reports" }o--|| users : "reporter"
    "reports" |o--|| "ReportTargetType" : "enum:targetType"
    "reports" |o--|o "ReleaseReportCategory" : "enum:releaseCategory"
    "reports" |o--|| "ReportStatus" : "enum:status"
    "reports" }o--|o users : "claimedBy"
    "reports" }o--|o users : "resolvedBy"
    "reports" |o--|o "ReportResolutionAction" : "enum:resolutionAction"
    "report_notes" }o--|| reports : "report"
    "report_notes" }o--|| users : "author"
    "site_settings" |o--|| "RegistrationStatus" : "enum:registrationStatus"
    "user_sessions" }o--|| users : "user"
    "account_recoveries" }o--|| users : "user"
    "user_email_histories" }o--|| users : "user"
    "user_warnings" }o--|| users : "user"
    "user_warnings" }o--|| users : "warnedBy"
    "user_moderation_notes" }o--|| users : "user"
    "user_moderation_notes" }o--|| users : "author"
    "user_donor_ranks" |o--|| users : "user"
    "user_donor_ranks" }o--|| donor_ranks : "donorRank"
    "request_votes" }o--|| requests : "request"
    "request_votes" }o--|| users : "user"
    "pm_drafts" }o--|| users : "user"
    "mass_messages" }o--|| users : "sender"
    "site_history" }o--|| users : "author"
    "wiki_pages" }o--|| users : "author"
    "wiki_revisions" }o--|| wiki_pages : "page"
    "wiki_revisions" }o--|| users : "author"
    "wiki_aliases" }o--|| wiki_pages : "page"
    "wiki_aliases" }o--|| users : "user"
    "rules_pages" }o--|| users : "author"
    "sub_rules" }o--|| rules : "rule"
    "release_votes" }o--|| releases : "release"
    "release_votes" }o--|| users : "user"
    "release_vote_aggregates" |o--|| releases : "release"
    "top10_snapshots" |o--|| "Top10SnapshotType" : "enum:type"
    "top10_snapshot_entries" }o--|| top10_snapshots : "snapshot"
    "top10_snapshot_entries" }o--|o releases : "release"
    "user_stat_snapshots" |o--|| "StatSnapshotPeriod" : "enum:period"
    "user_stat_snapshots" }o--|| users : "user"
    "community_health_snapshots" |o--|| "StatSnapshotPeriod" : "enum:period"
    "community_health_snapshots" }o--|| communities : "community"
    "crs_snapshots" |o--|| "StatSnapshotPeriod" : "enum:period"
    "crs_snapshots" }o--|| users : "user"
    "dev_seed_records" }o--|| dev_seed_runs : "run"
    "dev_seed_mutations" }o--|| dev_seed_runs : "run"
```
