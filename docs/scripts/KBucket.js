'use strict';

(function(){
/*Kademlia DHT K-bucket implementation as a binary tree.*/
/**
 * Implementation of a Kademlia DHT k-bucket used for storing
 * contact (peer node) information.
 *
 * @extends EventEmitter
 */
 function BuildKBucket(options = {}) {
    /**
     * `options`:
     *   `distance`: Function
     *     `function (firstId, secondId) { return distance }` An optional
     *     `distance` function that gets two `id` Uint8Arrays
     *     and return distance (as number) between them.
     *   `arbiter`: Function (Default: vectorClock arbiter)
     *     `function (incumbent, candidate) { return contact; }` An optional
     *     `arbiter` function that givent two `contact` objects with the same `id`
     *     returns the desired object to be used for updating the k-bucket. For
     *     more details, see [arbiter function](#arbiter-function).
     *   `localNodeId`: Uint8Array An optional Uint8Array representing the local node id.
     *     If not provided, a local node id will be created via `randomBytes(20)`.
     *     `metadata`: Object (Default: {}) Optional satellite data to include
     *     with the k-bucket. `metadata` property is guaranteed not be altered by,
     *     it is provided as an explicit container for users of k-bucket to store
     *     implementation-specific data.
     *   `numberOfNodesPerKBucket`: Integer (Default: 20) The number of nodes
     *     that a k-bucket can contain before being full or split.
     *     `numberOfNodesToPing`: Integer (Default: 3) The number of nodes to
     *     ping when a bucket that should not be split becomes full. KBucket will
     *     emit a `ping` event that contains `numberOfNodesToPing` nodes that have
     *     not been contacted the longest.
     *
     * @param {Object=} options optional
     */

    this.localNodeId = options.localNodeId || window.crypto.getRandomValues(new Uint8Array(20))
    this.numberOfNodesPerKBucket = options.numberOfNodesPerKBucket || 20
    this.numberOfNodesToPing = options.numberOfNodesToPing || 3
    this.distance = options.distance || this.distance
    // use an arbiter from options or vectorClock arbiter by default
    this.arbiter = options.arbiter || this.arbiter
    this.metadata = Object.assign({}, options.metadata)

    this.createNode = function() {
        return {
            contacts: [],
            dontSplit: false,
            left: null,
            right: null
        }
    }

    this.ensureInt8 = function(name, val) {
        if (!(val instanceof Uint8Array)) {
            throw new TypeError(name + ' is not a Uint8Array')
        }
    }

    /**
     * @param  {Uint8Array} array1
     * @param  {Uint8Array} array2
     * @return {Boolean}
     */
    this.arrayEquals = function(array1, array2) {
        if (array1 === array2) {
            return true
        }
        if (array1.length !== array2.length) {
            return false
        }
        for (let i = 0, length = array1.length; i < length; ++i) {
            if (array1[i] !== array2[i]) {
                return false
            }
        }
        return true
    }

    this.ensureInt8('option.localNodeId as parameter 1', this.localNodeId)
    this.root = this.createNode()

    /**
     * Default arbiter function for contacts with the same id. Uses
     * contact.vectorClock to select which contact to update the k-bucket with.
     * Contact with larger vectorClock field will be selected. If vectorClock is
     * the same, candidat will be selected.
     *
     * @param  {Object} incumbent Contact currently stored in the k-bucket.
     * @param  {Object} candidate Contact being added to the k-bucket.
     * @return {Object}           Contact to updated the k-bucket with.
     */
    this.arbiter = function(incumbent, candidate) {
        return incumbent.vectorClock > candidate.vectorClock ? incumbent : candidate
    }

    /**
     * Default distance function. Finds the XOR
     * distance between firstId and secondId.
     *
     * @param  {Uint8Array} firstId  Uint8Array containing first id.
     * @param  {Uint8Array} secondId Uint8Array containing second id.
     * @return {Number}              Integer The XOR distance between firstId
     *                               and secondId.
     */
    this.distance = function(firstId, secondId) {
        let distance = 0
        let i = 0
        const min = Math.min(firstId.length, secondId.length)
        const max = Math.max(firstId.length, secondId.length)
        for (; i < min; ++i) {
            distance = distance * 256 + (firstId[i] ^ secondId[i])
        }
        for (; i < max; ++i) distance = distance * 256 + 255
        return distance
    }

    /**
     * Adds a contact to the k-bucket.
     *
     * @param {Object} contact the contact object to add
     */
    this.add = function(contact) {
        this.ensureInt8('contact.id', (contact || {}).id)

        let bitIndex = 0
        let node = this.root

        while (node.contacts === null) {
            // this is not a leaf node but an inner node with 'low' and 'high'
            // branches; we will check the appropriate bit of the identifier and
            // delegate to the appropriate node for further processing
            node = this._determineNode(node, contact.id, bitIndex++)
        }

        // check if the contact already exists
        const index = this._indexOf(node, contact.id)
        if (index >= 0) {
            this._update(node, index, contact)
            return this
        }

        if (node.contacts.length < this.numberOfNodesPerKBucket) {
            node.contacts.push(contact)
            return this
        }

        // the bucket is full
        if (node.dontSplit) {
            // we are not allowed to split the bucket
            // we need to ping the first this.numberOfNodesToPing
            // in order to determine if they are alive
            // only if one of the pinged nodes does not respond, can the new contact
            // be added (this prevents DoS flodding with new invalid contacts)
            return this
        }

        this._split(node, bitIndex)
        return this.add(contact)
    }

    /**
     * Get the n closest contacts to the provided node id. "Closest" here means:
     * closest according to the XOR metric of the contact node id.
     *
     * @param  {Uint8Array} id  Contact node id
     * @param  {Number=} n      Integer (Default: Infinity) The maximum number of
     *                          closest contacts to return
     * @return {Array}          Array Maximum of n closest contacts to the node id
     */
    this.closest = function(id, n = Infinity) {
        this.ensureInt8('id', id)

        if ((!Number.isInteger(n) && n !== Infinity) || n <= 0) {
            throw new TypeError('n is not positive number')
        }

        let contacts = []

        for (let nodes = [this.root], bitIndex = 0; nodes.length > 0 && contacts.length < n;) {
            const node = nodes.pop()
            if (node.contacts === null) {
                const detNode = this._determineNode(node, id, bitIndex++)
                nodes.push(node.left === detNode ? node.right : node.left)
                nodes.push(detNode)
            } else {
                contacts = contacts.concat(node.contacts)
            }
        }

        return contacts
            .map(a => [this.distance(a.id, id), a])
            .sort((a, b) => a[0] - b[0])
            .slice(0, n)
            .map(a => a[1])
    }

    /**
     * Counts the total number of contacts in the tree.
     *
     * @return {Number} The number of contacts held in the tree
     */
    this.count = function() {
        // return this.toArray().length
        let count = 0
        for (const nodes = [this.root]; nodes.length > 0;) {
            const node = nodes.pop()
            if (node.contacts === null) nodes.push(node.right, node.left)
            else count += node.contacts.length
        }
        return count
    }

    /**
     * Determines whether the id at the bitIndex is 0 or 1.
     * Return left leaf if `id` at `bitIndex` is 0, right leaf otherwise
     *
     * @param  {Object} node     internal object that has 2 leafs: left and right
     * @param  {Uint8Array} id   Id to compare localNodeId with.
     * @param  {Number} bitIndex Integer (Default: 0) The bit index to which bit
     *                           to check in the id Uint8Array.
     * @return {Object}          left leaf if id at bitIndex is 0, right leaf otherwise.
     */
    this._determineNode = function(node, id, bitIndex) {
        // *NOTE* remember that id is a Uint8Array and has granularity of
        // bytes (8 bits), whereas the bitIndex is the bit index (not byte)

        // id's that are too short are put in low bucket (1 byte = 8 bits)
        // (bitIndex >> 3) finds how many bytes the bitIndex describes
        // bitIndex % 8 checks if we have extra bits beyond byte multiples
        // if number of bytes is <= no. of bytes described by bitIndex and there
        // are extra bits to consider, this means id has less bits than what
        // bitIndex describes, id therefore is too short, and will be put in low
        // bucket
        const bytesDescribedByBitIndex = bitIndex >> 3
        const bitIndexWithinByte = bitIndex % 8
        if ((id.length <= bytesDescribedByBitIndex) && (bitIndexWithinByte !== 0)) {
            return node.left
        }

        const byteUnderConsideration = id[bytesDescribedByBitIndex]

        // byteUnderConsideration is an integer from 0 to 255 represented by 8 bits
        // where 255 is 11111111 and 0 is 00000000
        // in order to find out whether the bit at bitIndexWithinByte is set
        // we construct (1 << (7 - bitIndexWithinByte)) which will consist
        // of all bits being 0, with only one bit set to 1
        // for example, if bitIndexWithinByte is 3, we will construct 00010000 by
        // (1 << (7 - 3)) -> (1 << 4) -> 16
        if (byteUnderConsideration & (1 << (7 - bitIndexWithinByte))) {
            return node.right
        }

        return node.left
    }

    /**
     * Get a contact by its exact ID.
     * If this is a leaf, loop through the bucket contents and return the correct
     * contact if we have it or null if not. If this is an inner node, determine
     * which branch of the tree to traverse and repeat.
     *
     * @param  {Uint8Array} id The ID of the contact to fetch.
     * @return {Object|Null}   The contact if available, otherwise null
     */
    this.get = function(id) {
        this.ensureInt8('id', id)

        let bitIndex = 0

        let node = this.root
        while (node.contacts === null) {
            node = this._determineNode(node, id, bitIndex++)
        }

        // index of uses contact id for matching
        const index = this._indexOf(node, id)
        return index >= 0 ? node.contacts[index] : null
    }

    /**
     * Returns the index of the contact with provided
     * id if it exists, returns -1 otherwise.
     *
     * @param  {Object} node    internal object that has 2 leafs: left and right
     * @param  {Uint8Array} id  Contact node id.
     * @return {Number}         Integer Index of contact with provided id if it
     *                          exists, -1 otherwise.
     */
    this._indexOf = function(node, id) {
        for (let i = 0; i < node.contacts.length; ++i) {
            if (this.arrayEquals(node.contacts[i].id, id)) return i
        }

        return -1
    }

    /**
     * Removes contact with the provided id.
     *
     * @param  {Uint8Array} id The ID of the contact to remove.
     * @return {Object}        The k-bucket itself.
     */
    this.remove = function(id) {
        this.ensureInt8('the id as parameter 1', id)

        let bitIndex = 0
        let node = this.root

        while (node.contacts === null) {
            node = this._determineNode(node, id, bitIndex++)
        }

        const index = this._indexOf(node, id)
        if (index >= 0) {
            const contact = node.contacts.splice(index, 1)[0]
        }

        return this
    }

    /**
     * Splits the node, redistributes contacts to the new nodes, and marks the
     * node that was split as an inner node of the binary tree of nodes by
     * setting this.root.contacts = null
     *
     * @param  {Object} node     node for splitting
     * @param  {Number} bitIndex the bitIndex to which byte to check in the
     *                           Uint8Array for navigating the binary tree
     */
    this._split = function(node, bitIndex) {
        node.left = this.createNode()
        node.right = this.createNode()

        // redistribute existing contacts amongst the two newly created nodes
        for (const contact of node.contacts) {
            this._determineNode(node, contact.id, bitIndex).contacts.push(contact)
        }

        node.contacts = null // mark as inner tree node

        // don't split the "far away" node
        // we check where the local node would end up and mark the other one as
        // "dontSplit" (i.e. "far away")
        const detNode = this._determineNode(node, this.localNodeId, bitIndex)
        const otherNode = node.left === detNode ? node.right : node.left
        otherNode.dontSplit = true
    }

    /**
     * Returns all the contacts contained in the tree as an array.
     * If this is a leaf, return a copy of the bucket. `slice` is used so that we
     * don't accidentally leak an internal reference out that might be
     * accidentally misused. If this is not a leaf, return the union of the low
     * and high branches (themselves also as arrays).
     *
     * @return {Array} All of the contacts in the tree, as an array
     */
    this.toArray = function() {
        let result = []
        for (const nodes = [this.root]; nodes.length > 0;) {
            const node = nodes.pop()
            if (node.contacts === null) nodes.push(node.right, node.left)
            else result = result.concat(node.contacts)
        }
        return result
    }

    /**
     * Updates the contact selected by the arbiter.
     * If the selection is our old contact and the candidate is some new contact
     * then the new contact is abandoned (not added).
     * If the selection is our old contact and the candidate is our old contact
     * then we are refreshing the contact and it is marked as most recently
     * contacted (by being moved to the right/end of the bucket array).
     * If the selection is our new contact, the old contact is removed and the new
     * contact is marked as most recently contacted.
     *
     * @param  {Object} node    internal object that has 2 leafs: left and right
     * @param  {Number} index   the index in the bucket where contact exists
     *                          (index has already been computed in a previous
     *                          calculation)
     * @param  {Object} contact The contact object to update.
     */
    this._update = function(node, index, contact) {
        // sanity check
        if (!this.arrayEquals(node.contacts[index].id, contact.id)) {
            throw new Error('wrong index for _update')
        }

        const incumbent = node.contacts[index]
        const selection = this.arbiter(incumbent, contact)
        // if the selection is our old contact and the candidate is some new
        // contact, then there is nothing to do
        if (selection === incumbent && incumbent !== contact) return

        node.contacts.splice(index, 1) // remove old contact
        node.contacts.push(selection) // add more recent contact version

    }
}

function K_Bucket(masterID, backupList) {
    const decodeID = function(floID) {
        let k = bitjs.Base58.decode(floID);
        k.shift();
        k.splice(-4, 4);
        const decodedId = Crypto.util.bytesToHex(k);
        const nodeIdBigInt = new BigInteger(decodedId, 16);
        const nodeIdBytes = nodeIdBigInt.toByteArrayUnsigned();
        const nodeIdNewInt8Array = new Uint8Array(nodeIdBytes);
        return nodeIdNewInt8Array;
    };
    const _KB = new BuildKBucket({
        localNodeId: decodeID(masterID)
    });
    backupList.forEach(id => _KB.add({
        id: decodeID(id),
        floID: id
    }));
    const orderedList = backupList.map(sn => [_KB.distance(decodeID(masterID), decodeID(sn)), sn])
        .sort((a, b) => a[0] - b[0])
        .map(a => a[1]);
    const self = this;

    Object.defineProperty(self, 'order', {
        get: () => Array.from(orderedList)
    });

    self.closestNode = function(id, N = 1) {
        let decodedId = decodeID(id);
        let n = N || orderedList.length;
        let cNodes = _KB.closest(decodedId, n)
            .map(k => k.floID);
        return (N == 1 ? cNodes[0] : cNodes);
    };

    self.isBefore = (source, target) => orderedList.indexOf(target) < orderedList.indexOf(source);
    self.isAfter = (source, target) => orderedList.indexOf(target) > orderedList.indexOf(source);
    self.isPrev = (source, target) => orderedList.indexOf(target) === orderedList.indexOf(source) - 1;
    self.isNext = (source, target) => orderedList.indexOf(target) === orderedList.indexOf(source) + 1;

    self.prevNode = function(id, N = 1) {
        let n = N || orderedList.length;
        if (!orderedList.includes(id))
            throw Error(`${id} is not in KB list`);
        let pNodes = orderedList.slice(0, orderedList.indexOf(id)).slice(-n);
        return (N == 1 ? pNodes[0] : pNodes);
    };

    self.nextNode = function(id, N = 1) {
        let n = N || orderedList.length;
        if (!orderedList.includes(id))
            throw Error(`${id} is not in KB list`);
        let nNodes = orderedList.slice(orderedList.indexOf(id) + 1).slice(0, n);
        return (N == 1 ? nNodes[0] : nNodes);
    };

};
('object' === typeof module) ? module.exports = K_Bucket : window.K_Bucket = K_Bucket;
})();