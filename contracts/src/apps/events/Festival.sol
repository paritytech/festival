// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import "../../protocols/nontransferable/NonTransferableERC721.sol";
import "../../protocols/poap/IAttendancePOAP.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "./FestivalSession.sol";

/// @title Festival: Core event contract with registration, check-in, POAP, and sub-events
contract Festival is NonTransferableERC721, AccessControlEnumerable {
    // ── Role Constants ──

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant VOLUNTEER_ROLE = keccak256("VOLUNTEER_ROLE");

    // ── Errors ──

    error AlreadyRegistered();
    error NotRegistered();
    error AlreadyCheckedIn();
    error EventFull();
    error IsCancelled();
    error CapacityBelowRegistered();
    error SessionsDisabled();
    error AlreadyConfigured();
    error NotAuthorizedToCreateSession();
    error SessionStartsBeforeFestival();
    error SessionEndsAfterFestival();
    error NotASession();
    error SessionLimitReached();
    error NotAuthorizedToCancelSession();
    error InvalidTimeRange();
    error SessionAlreadyCancelled();
    error MissingChannelMetadata();
    error MissingMetadata();

    // ── Events ──

    event Registered(address indexed attendee, uint256 tokenId);
    event CheckedIn(address indexed attendee);
    event MetadataUpdated(bytes32 newCid);
    event CapacityUpdated(uint32 newCapacity);
    event FestivalCancelled();
    event SessionCreated(address indexed session, address indexed creator, bytes32 metadataCid);
    event SessionsEnabledUpdated(bool enabled);
    event SessionCancelledByFlagging(address indexed session, address indexed creator, uint256 flagCount);
    event ChannelMetadataUpdated(bytes32 newCid);

    // ── Storage ──

    bytes32 public metadataCid;
    bytes32 public channelMetadataCid;
    address public creator;
    address public festivalPoapContract;
    address public sessionPoapContract;
    uint64 public startTime;
    uint64 public endTime;
    bool public sessionsEnabled;
    uint32 public capacity;
    bool public cancelled;
    bool private _configured;

    uint256 private _nextTokenId = 1;
    uint256 public registeredCount;
    address[] private _attendees;

    mapping(address => bool) public isRegistered;
    mapping(address => bool) public isCheckedIn;
    mapping(address => uint256) public ticketOf;
    address[] public sessions;
    mapping(address => bool) public isSession;
    mapping(address => address) public sessionCreator;
    mapping(address => mapping(uint256 => uint256)) public sessionsPerDay;

    // ── Modifiers ──

    modifier notCancelled() {
        if (cancelled) revert IsCancelled();
        _;
    }

    // ── Constructor ──

    constructor(
        address _creator,
        address _festivalPoapContract,
        address _sessionPoapContract,
        bool _sessionsEnabled
    ) NonTransferableERC721("Festival Ticket", "FTICKET") {
        creator = _creator;
        festivalPoapContract = _festivalPoapContract;
        sessionPoapContract = _sessionPoapContract;
        sessionsEnabled = _sessionsEnabled;

        // Grant all roles to creator
        _grantRole(DEFAULT_ADMIN_ROLE, _creator);
        _grantRole(MANAGER_ROLE, _creator);
        _grantRole(VOLUNTEER_ROLE, _creator);
    }

    /// @notice One-shot configuration by admin after deployment.
    /// Must be called after Festival is authorized as a minter on the festival POAP contract.
    function setup(
        bytes32 _metadataCid,
        bytes32 _channelMetadataCid,
        uint64 _startTime,
        uint64 _endTime,
        uint32 _capacity
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_configured) revert AlreadyConfigured();
        if (_endTime <= _startTime) revert InvalidTimeRange();
        if (_metadataCid == bytes32(0)) revert MissingMetadata();
        if (_channelMetadataCid == bytes32(0)) revert MissingChannelMetadata();
        _configured = true;

        metadataCid = _metadataCid;
        channelMetadataCid = _channelMetadataCid;
        startTime = _startTime;
        endTime = _endTime;
        capacity = _capacity;

        emit ChannelMetadataUpdated(_channelMetadataCid);
    }

    /// @notice Update the channel metadata CID. Manager-only.
    function updateChannelMetadataCid(bytes32 newCid) external {
        _requireManagerRole();
        if (newCid == bytes32(0)) revert MissingChannelMetadata();
        channelMetadataCid = newCid;
        emit ChannelMetadataUpdated(newCid);
    }

    // ── Event Lifecycle ──

    /// @notice Register for the festival. Mints a soulbound ticket.
    function register() external notCancelled {
        if (isRegistered[msg.sender]) revert AlreadyRegistered();
        if (capacity > 0 && registeredCount >= capacity) revert EventFull();

        uint256 tokenId = _nextTokenId++;
        isRegistered[msg.sender] = true;
        ticketOf[msg.sender] = tokenId;
        registeredCount++;
        _attendees.push(msg.sender);

        _safeMint(msg.sender, tokenId);

        emit Registered(msg.sender, tokenId);
    }

    /// @notice Check in a registered attendee. Mints POAP atomically.
    function checkIn(address attendee) external notCancelled {
        _requireVolunteerRole();
        if (!isRegistered[attendee]) revert NotRegistered();
        if (isCheckedIn[attendee]) revert AlreadyCheckedIn();

        isCheckedIn[attendee] = true;
        IAttendancePOAP(festivalPoapContract).mintPOAP(attendee, address(this));

        emit CheckedIn(attendee);
    }

    /// @notice Register + check in in one call. For off-chain ticket holders.
    function manualCheckIn(address attendee) external notCancelled {
        _requireVolunteerRole();
        if (isCheckedIn[attendee]) revert AlreadyCheckedIn();

        // Auto-register if not registered
        if (!isRegistered[attendee]) {
            if (capacity > 0 && registeredCount >= capacity) revert EventFull();

            uint256 tokenId = _nextTokenId++;
            isRegistered[attendee] = true;
            ticketOf[attendee] = tokenId;
            registeredCount++;
            _attendees.push(attendee);

            _safeMint(attendee, tokenId);

            emit Registered(attendee, tokenId);
        }

        isCheckedIn[attendee] = true;
        IAttendancePOAP(festivalPoapContract).mintPOAP(attendee, address(this));

        emit CheckedIn(attendee);
    }

    /// @notice Update metadata CID
    function updateCid(bytes32 newCid) external {
        _requireManagerRole();
        if (newCid == bytes32(0)) revert MissingMetadata();
        metadataCid = newCid;
        emit MetadataUpdated(newCid);
    }

    /// @notice Update capacity
    function updateCapacity(uint32 newCapacity) external {
        _requireManagerRole();
        if (newCapacity != 0 && newCapacity < registeredCount) revert CapacityBelowRegistered();
        capacity = newCapacity;
        emit CapacityUpdated(newCapacity);
    }

    /// @notice Cancel the festival. Irreversible.
    function cancel() external onlyRole(DEFAULT_ADMIN_ROLE) notCancelled {
        cancelled = true;
        emit FestivalCancelled();
    }

    // ── Session Management ──

    /// @notice Deploy a new session under this festival
    function createSession(
        bytes32 _metadataCid,
        uint64 _startTimestamp,
        uint64 _endTimestamp,
        uint256 _festivalPoapTokenId
    ) external notCancelled returns (address) {
        if (!sessionsEnabled) revert SessionsDisabled();
        if (_metadataCid == bytes32(0)) revert MissingMetadata();

        // POAP-only authorization: must own a festival POAP minted by this contract
        IAttendancePOAP poap = IAttendancePOAP(festivalPoapContract);
        IAttendancePOAP.POAPData memory data = poap.getPOAPData(_festivalPoapTokenId);
        if (data.attendee != msg.sender || data.sourceContract != address(this)) {
            revert NotAuthorizedToCreateSession();
        }

        // Time bounds validation
        if (_endTimestamp <= _startTimestamp) revert InvalidTimeRange();
        if (_startTimestamp < startTime) revert SessionStartsBeforeFestival();
        if (_endTimestamp > endTime) revert SessionEndsAfterFestival();

        // Session limit: max 2 per creator per festival day
        uint256 dayIndex = (uint256(_startTimestamp) - uint256(startTime)) / 86400;
        if (sessionsPerDay[msg.sender][dayIndex] >= 2) revert SessionLimitReached();
        sessionsPerDay[msg.sender][dayIndex]++;

        // Deploy session
        FestivalSession session = new FestivalSession(
            msg.sender,
            sessionPoapContract,
            _metadataCid,
            _startTimestamp,
            _endTimestamp,
            address(this),
            festivalPoapContract
        );

        address sessionAddr = address(session);
        sessions.push(sessionAddr);
        isSession[sessionAddr] = true;
        sessionCreator[sessionAddr] = msg.sender;

        // Authorize session as POAP minter, auto-check-in creator
        IAttendancePOAP(sessionPoapContract).authorizeMinter(sessionAddr);
        session.initCreator();

        emit SessionCreated(sessionAddr, msg.sender, _metadataCid);

        return sessionAddr;
    }

    // ── Policy Management ──

    function updateSessionsEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        sessionsEnabled = enabled;
        emit SessionsEnabledUpdated(enabled);
    }

    /// @notice Cancel a session.
    /// @dev Below the flag threshold: only the session's DEFAULT_ADMIN_ROLE (the creator); slot is restored.
    /// At or above threshold: a Festival admin/manager only — the creator is blocked so they cannot
    /// self-cancel to dodge moderation, and the per-day slot stays consumed.
    function cancelSession(address sessionAddr) external {
        if (!isSession[sessionAddr]) revert NotASession();
        FestivalSession session = FestivalSession(payable(sessionAddr));
        if (session.cancelled()) revert SessionAlreadyCancelled();

        address creator_ = sessionCreator[sessionAddr];
        uint256 flagCount = session.flagCount();

        if (flagCount >= session.FLAG_THRESHOLD()) {
            if (msg.sender == creator_) revert NotAuthorizedToCancelSession();
            if (
                !hasRole(DEFAULT_ADMIN_ROLE, msg.sender) &&
                !hasRole(MANAGER_ROLE, msg.sender)
            ) {
                revert NotAuthorizedToCancelSession();
            }
            emit SessionCancelledByFlagging(sessionAddr, creator_, flagCount);
        } else {
            if (!session.hasRole(session.DEFAULT_ADMIN_ROLE(), msg.sender)) {
                revert NotAuthorizedToCancelSession();
            }
            uint256 dayIndex = (uint256(session.startTime()) - uint256(startTime)) / 86400;
            sessionsPerDay[creator_][dayIndex]--;
        }

        session.cancel();
    }

    // ── Views ──

    function getAttendees()
        external
        view
        returns (address[] memory attendees, bool[] memory checkedInStatus)
    {
        attendees = _attendees;
        checkedInStatus = new bool[](attendees.length);
        for (uint256 i = 0; i < attendees.length; i++) {
            checkedInStatus[i] = isCheckedIn[attendees[i]];
        }
    }

    function getEventDetails()
        external
        view
        returns (
            bytes32, address, address, address,
            uint64, uint64,
            bool, uint32,
            bool, uint256
        )
    {
        return (
            metadataCid, creator, festivalPoapContract, sessionPoapContract,
            startTime, endTime,
            sessionsEnabled, capacity,
            cancelled, registeredCount
        );
    }

    function getSessions() external view returns (address[] memory) {
        return sessions;
    }

    function getSessionCount() external view returns (uint256) {
        return sessions.length;
    }

    // ── Internal ──

    function _requireVolunteerRole() internal view {
        if (
            !hasRole(VOLUNTEER_ROLE, msg.sender) &&
            !hasRole(MANAGER_ROLE, msg.sender) &&
            !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)
        ) {
            revert AccessControlUnauthorizedAccount(msg.sender, VOLUNTEER_ROLE);
        }
    }

    function _requireManagerRole() internal view {
        if (
            !hasRole(MANAGER_ROLE, msg.sender) &&
            !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)
        ) {
            revert AccessControlUnauthorizedAccount(msg.sender, MANAGER_ROLE);
        }
    }

    /// @dev Override required by Solidity for dual inheritance (ERC721 + AccessControlEnumerable)
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControlEnumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

}
