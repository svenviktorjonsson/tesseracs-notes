import { sqrDist, distToSegmentSquared } from './utils/math.js'; // Keep math utils if needed for graph logic

export class Graph {
    constructor() {
        this.nodeRegistry = new Map(); // Map<string, { id: string, x: number, y: number }>
        this.edgeRegistry = new Map(); // Map<string, { id: string, node1Id: string, node2Id: string, color: string, lineWidth: number }>
    }

    // --- Node Methods ---

    createNode(id, x, y) {
        if (this.nodeRegistry.has(id)) return this.nodeRegistry.get(id);
        const nodeData = { id, x, y };
        this.nodeRegistry.set(id, nodeData);
        return { ...nodeData }; // Return a copy
    }

    getNode(id) {
        const node = this.nodeRegistry.get(id);
        return node ? { ...node } : null; // Return a copy
    }

    getAllNodes() {
        return Array.from(this.nodeRegistry.values()).map(node => ({ ...node })); // Return copies
    }

    updateNodePosition(id, x, y) {
        const node = this.nodeRegistry.get(id);
        if (node) {
            node.x = x;
            node.y = y;
            return true;
        }
        return false;
    }

    /**
     * Internal node deletion - only removes the node itself.
     * Returns the deleted node data or null.
     */
    _deleteNodeOnly(id) {
        if (!this.nodeRegistry.has(id)) return null;
        const deletedNode = { ...this.nodeRegistry.get(id) };
        this.nodeRegistry.delete(id);
        return deletedNode;
    }

    // --- Edge Methods ---

    createEdge(id, node1Id, node2Id, color, lineWidth) {
        if (this.edgeRegistry.has(id)) return this.edgeRegistry.get(id);
        if (!this.nodeRegistry.has(node1Id) || !this.nodeRegistry.has(node2Id)) {
            console.warn(`Attempted to create edge ${id} with missing node(s): ${node1Id}, ${node2Id}`);
            return null;
        }
        const edgeData = { id, node1Id, node2Id, color, lineWidth };
        this.edgeRegistry.set(id, edgeData);
        return { ...edgeData }; // Return a copy
    }

    getEdge(id) {
        const edge = this.edgeRegistry.get(id);
        return edge ? { ...edge } : null; // Return a copy
    }

    getAllEdges() {
        return Array.from(this.edgeRegistry.values()).map(edge => ({ ...edge })); // Return copies
    }

    updateEdgeProperties(id, properties) {
        const edge = this.edgeRegistry.get(id);
        if (edge) {
            if (properties.color !== undefined) edge.color = properties.color;
            if (properties.lineWidth !== undefined) edge.lineWidth = properties.lineWidth;
            return true;
        }
        return false;
    }

    /**
     * Internal edge deletion - only removes the edge itself.
     * Returns the deleted edge data or null.
     */
    _deleteEdgeOnly(id) {
        if (!this.edgeRegistry.has(id)) return null;
        const deletedEdge = { ...this.edgeRegistry.get(id) };
        this.edgeRegistry.delete(id);
        return deletedEdge;
    }

    // --- Graph Query Methods ---

    getNodeDegree(nodeId) {
        let degree = 0;
        for (const edge of this.edgeRegistry.values()) {
            if (edge.node1Id === nodeId || edge.node2Id === nodeId) {
                degree++;
            }
        }
        return degree;
    }

    edgeExists(node1Id, node2Id) {
        for (const edge of this.edgeRegistry.values()) {
            if ((edge.node1Id === node1Id && edge.node2Id === node2Id) ||
                (edge.node1Id === node2Id && edge.node2Id === node1Id)) {
                return true;
            }
        }
        return false;
    }

    getIncidentEdges(nodeId) {
        const incident = [];
        for (const edge of this.edgeRegistry.values()) {
            if (edge.node1Id === nodeId || edge.node2Id === nodeId) {
                incident.push({ ...edge }); // Return copies
            }
        }
        return incident;
    }

    /**
     * Finds the connected component (nodes and edges) containing a start element.
     * @param {string} startElementId - ID of the starting node or edge.
     * @param {'node' | 'edge'} elementType - Type of the starting element.
     * @returns {{ componentNodes: Set<string>, componentEdges: Set<string>, representativeId: string | null }}
     */
    findConnectedComponent(startElementId, elementType) {
        const componentNodes = new Set();
        const componentEdges = new Set();
        const queue = [];
        const visitedNodes = new Set();
        const visitedEdges = new Set();
        let startNodeId = null;
        let startEdge = null;
        let representativeId = startElementId;

        if (elementType === 'node') {
            if (!this.nodeRegistry.has(startElementId)) return { componentNodes, componentEdges, representativeId: null };
            startNodeId = startElementId;
        } else if (elementType === 'edge') {
            startEdge = this.edgeRegistry.get(startElementId);
            if (!startEdge) return { componentNodes, componentEdges, representativeId: null };
            visitedEdges.add(startElementId);
            componentEdges.add(startElementId);
        } else {
            // Should not happen for graph components
            return { componentNodes, componentEdges, representativeId: null };
        }

        // Determine initial node(s) to start BFS from
        let initialNodeId = null;
        if (startNodeId) {
            initialNodeId = startNodeId;
        } else if (startEdge) {
            initialNodeId = startEdge.node1Id; // Start BFS from one end of the edge
        }

        if (initialNodeId && this.nodeRegistry.has(initialNodeId) && !visitedNodes.has(initialNodeId)) {
            queue.push(initialNodeId);
            visitedNodes.add(initialNodeId);
            componentNodes.add(initialNodeId);
            representativeId = representativeId ?? initialNodeId;
        }

        // If starting from an edge, also add the other end node if not already visited
        if (startEdge && startEdge.node2Id && this.nodeRegistry.has(startEdge.node2Id) && !visitedNodes.has(startEdge.node2Id)) {
            const node2Id = startEdge.node2Id;
            queue.push(node2Id);
            visitedNodes.add(node2Id);
            componentNodes.add(node2Id);
            representativeId = representativeId ?? node2Id;
        }

        // Breadth-First Search
        while (queue.length > 0) {
            const currentNodeId = queue.shift();

            for (const edge of this.edgeRegistry.values()) {
                let neighborNodeId = null;
                let involvedEdge = false;

                // Check if current node is part of this edge
                if (edge.node1Id === currentNodeId) {
                    neighborNodeId = edge.node2Id;
                    involvedEdge = true;
                } else if (edge.node2Id === currentNodeId) {
                    neighborNodeId = edge.node1Id;
                    involvedEdge = true;
                }

                // If the edge involves the current node
                if (involvedEdge) {
                    // If the neighbor exists and hasn't been visited, add it to the queue/component
                    if (neighborNodeId && this.nodeRegistry.has(neighborNodeId) && !visitedNodes.has(neighborNodeId)) {
                        visitedNodes.add(neighborNodeId);
                        componentNodes.add(neighborNodeId);
                        queue.push(neighborNodeId);
                    }
                    // If the edge itself hasn't been visited, add it to the component
                    if (!visitedEdges.has(edge.id)) {
                        visitedEdges.add(edge.id);
                        componentEdges.add(edge.id);
                    }
                }
            }
        }

        // Find a representative ID if the original wasn't a node
        if (!representativeId && componentNodes.size > 0) {
            representativeId = componentNodes.values().next().value;
        } else if (!representativeId && componentEdges.size > 0) {
            representativeId = componentEdges.values().next().value; // Fallback to an edge ID if no nodes
        }


        return { componentNodes, componentEdges, representativeId };
    }


    // --- Complex Deletion Logic ---

    /**
     * Deletes a node and its incident edges. If the node was degree 2,
     * it attempts to connect its neighbors with a new edge.
     * @param {string} nodeId - The ID of the node to delete.
     * @param {function} generateId - Function to generate new IDs if needed.
     * @returns {{ deletedNode: object | null, deletedEdges: object[], createdEdge: object | null }} Information about changes.
     */
    deleteNodeSmart(nodeId, generateId) {
        const deletedNodeData = { deletedNode: null, deletedEdges: [], createdEdge: null };
        if (!this.nodeRegistry.has(nodeId)) return deletedNodeData;

        const incidentEdgesData = this.getIncidentEdges(nodeId);

        // Check for degree 2 case to potentially connect neighbors
        if (incidentEdgesData.length === 2) {
            const edge1 = incidentEdgesData[0];
            const edge2 = incidentEdgesData[1];
            const neighbour1Id = (edge1.node1Id === nodeId) ? edge1.node2Id : edge1.node1Id;
            const neighbour2Id = (edge2.node1Id === nodeId) ? edge2.node2Id : edge2.node1Id;

            // Check if neighbors are distinct and exist
            if (neighbour1Id !== neighbour2Id && this.nodeRegistry.has(neighbour1Id) && this.nodeRegistry.has(neighbour2Id)) {
                // Check if an edge doesn't already exist between neighbors
                if (!this.edgeExists(neighbour1Id, neighbour2Id)) {
                    // Proceed with deletion and creation of the new edge
                    const dn = this._deleteNodeOnly(nodeId);
                    if (dn) {
                        deletedNodeData.deletedNode = dn;
                        const de1 = this._deleteEdgeOnly(edge1.id);
                        const de2 = this._deleteEdgeOnly(edge2.id);
                        if (de1) deletedNodeData.deletedEdges.push(de1);
                        if (de2) deletedNodeData.deletedEdges.push(de2);

                        // Create the new edge (use properties from one of the deleted edges)
                        const newEdgeId = generateId();
                        const newEdge = this.createEdge(newEdgeId, neighbour1Id, neighbour2Id, edge1.color, edge1.lineWidth);
                        if (newEdge) deletedNodeData.createdEdge = newEdge;
                        return deletedNodeData; // Finished handling degree 2 case
                    }
                }
            }
        }

        // Standard deletion (not degree 2 or failed to connect neighbors)
        const dnStandard = this._deleteNodeOnly(nodeId);
        if (dnStandard) {
            deletedNodeData.deletedNode = dnStandard;
            incidentEdgesData.forEach(edge => {
                const deletedEdge = this._deleteEdgeOnly(edge.id);
                if (deletedEdge) {
                    deletedNodeData.deletedEdges.push(deletedEdge);
                }
            });
        }

        return deletedNodeData;
    }

    /**
     * Deletes an edge. If deleting the edge leaves either endpoint node with degree 0,
     * that node is also deleted.
     * @param {string} edgeId - The ID of the edge to delete.
     * @param {function} generateId - Function to generate IDs (needed by deleteNodeSmart).
     * @returns {{ deletedEdge: object | null, deletedNodes: object[], deletedEdges: object[] }} Information about changes (deletedNodes/Edges includes consequential deletions).
     */
    deleteEdgeSmart(edgeId, generateId) {
        const deletedEdgeData = { deletedEdge: null, deletedNodes: [], deletedEdges: [] };
        const edgeToDelete = this.edgeRegistry.get(edgeId);

        if (!edgeToDelete) return deletedEdgeData;

        const node1Id = edgeToDelete.node1Id;
        const node2Id = edgeToDelete.node2Id;

        // Delete the primary edge first
        const de = this._deleteEdgeOnly(edgeId);
        if (!de) return deletedEdgeData; // Should not happen if edgeToDelete existed
        deletedEdgeData.deletedEdge = de;

        // Check node 1 after edge deletion
        if (this.nodeRegistry.has(node1Id) && this.getNodeDegree(node1Id) === 0) {
            const { deletedNode: dn1, deletedEdges: de1_consq } = this.deleteNodeSmart(node1Id, generateId); // Usually no consequent edges here
            if (dn1) deletedEdgeData.deletedNodes.push(dn1);
            deletedEdgeData.deletedEdges.push(...de1_consq);
        }

        // Check node 2 after edge deletion
        if (this.nodeRegistry.has(node2Id) && this.getNodeDegree(node2Id) === 0) {
            const { deletedNode: dn2, deletedEdges: de2_consq } = this.deleteNodeSmart(node2Id, generateId); // Usually no consequent edges here
            if (dn2) deletedEdgeData.deletedNodes.push(dn2);
            deletedEdgeData.deletedEdges.push(...de2_consq);
        }

        return deletedEdgeData;
    }

    /**
     * High-level function to delete multiple nodes and edges, handling consequences.
     * @param {Set<string>} nodeIdsToDelete
     * @param {Set<string>} edgeIdsToDelete
     * @param {function} generateId
     * @returns {{ deletedNodes: object[], deletedEdges: object[], createdEdges: object[] }} Detailed changes.
     */
    deleteNodesAndEdges(nodeIdsToDelete, edgeIdsToDelete, generateId) {
        const finalDeleted = { deletedNodes: [], deletedEdges: [], createdEdges: [] };
        const processedNodes = new Set();
        const processedEdges = new Set();

        // Prioritize deleting specified edges first, as this might trigger node deletion
        edgeIdsToDelete.forEach(edgeId => {
            if (processedEdges.has(edgeId) || !this.edgeRegistry.has(edgeId)) return;

            const { deletedEdge: de, deletedNodes: dn_consq, deletedEdges: de_consq } = this.deleteEdgeSmart(edgeId, generateId);

            if (de) {
                finalDeleted.deletedEdges.push(de);
                processedEdges.add(de.id);
            }
            dn_consq.forEach(n => {
                if (!processedNodes.has(n.id)) {
                    finalDeleted.deletedNodes.push(n);
                    processedNodes.add(n.id);
                    nodeIdsToDelete.delete(n.id); // Remove from explicit list if consequentially deleted
                }
            });
            // Consequential edge deletions from deleting degree-0 nodes (should be rare here)
            de_consq.forEach(e => {
                if (!processedEdges.has(e.id)) {
                    finalDeleted.deletedEdges.push(e);
                    processedEdges.add(e.id);
                     edgeIdsToDelete.delete(e.id); // Remove from explicit list
                }
            });
        });

        // Now delete remaining specified nodes
        nodeIdsToDelete.forEach(nodeId => {
            if (processedNodes.has(nodeId) || !this.nodeRegistry.has(nodeId)) return;

            const { deletedNode: dn, deletedEdges: de_consq, createdEdge: ce } = this.deleteNodeSmart(nodeId, generateId);

            if (dn) {
                finalDeleted.deletedNodes.push(dn);
                processedNodes.add(dn.id);
            }
            de_consq.forEach(e => {
                if (!processedEdges.has(e.id)) {
                    finalDeleted.deletedEdges.push(e);
                    processedEdges.add(e.id);
                    edgeIdsToDelete.delete(e.id); // Remove from explicit list
                }
            });
            if (ce) {
                 if (!processedEdges.has(ce.id)) { // Avoid adding if it was somehow deleted again
                     finalDeleted.createdEdges.push(ce);
                     // Don't add to processedEdges, it's a creation
                 }
            }
        });

        // Filter duplicates just in case (shouldn't be strictly necessary with processed sets)
        finalDeleted.deletedNodes = finalDeleted.deletedNodes.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
        finalDeleted.deletedEdges = finalDeleted.deletedEdges.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
        finalDeleted.createdEdges = finalDeleted.createdEdges.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);


        return finalDeleted;
    }


    /**
     * Adds nodes and edges back to the graph (used for undoing deletions).
     * Assumes IDs are consistent.
     * @param {object[]} nodesToAdd - Array of node data objects.
     * @param {object[]} edgesToAdd - Array of edge data objects.
     */
    addNodesAndEdges(nodesToAdd, edgesToAdd) {
        nodesToAdd.forEach(n => {
            if (!this.nodeRegistry.has(n.id)) {
                this.nodeRegistry.set(n.id, { ...n });
            } else {
                 console.warn(`Undo: Node ${n.id} already exists.`);
                 this.nodeRegistry.get(n.id).x = n.x; // Update position just in case
                 this.nodeRegistry.get(n.id).y = n.y;
            }
        });
        edgesToAdd.forEach(e => {
             if (!this.edgeRegistry.has(e.id)) {
                 // Ensure nodes exist before adding edge
                 if(this.nodeRegistry.has(e.node1Id) && this.nodeRegistry.has(e.node2Id)) {
                    this.edgeRegistry.set(e.id, { ...e });
                 } else {
                     console.warn(`Undo: Could not add edge ${e.id}, missing nodes ${e.node1Id} or ${e.node2Id}`);
                 }
             } else {
                 console.warn(`Undo: Edge ${e.id} already exists.`);
             }
        });
    }


    // --- Utility Methods ---

    // (Removed getNodeAtPoint, getEdgeAtPoint - Keep in Editor)
}