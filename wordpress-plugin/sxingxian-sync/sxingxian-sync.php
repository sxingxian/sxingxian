<?php
/**
 * Plugin Name: sxingxian sync
 * Description: Notifies sxingxian.com when a post is published, updated, unpublished or deleted, so the main site stays in sync. Sends only the post ID — sxingxian.com fetches the post back from the public REST API.
 * Version: 1.0.0
 * Author: sxingxian
 * License: MIT
 *
 * Setup (hey.sxingxian.com):
 *   1. Upload this folder to wp-content/plugins/ and activate it in hey.sxingxian.com/admin.
 *   2. Add to wp-config.php (above "That's all, stop editing!"), using the SAME secret
 *      you stored on Cloudflare with `wrangler secret put WP_WEBHOOK_SECRET`:
 *        define( 'SXINGXIAN_WEBHOOK_URL', 'https://sxingxian.com/api/hooks/wordpress' );
 *        define( 'SXINGXIAN_WEBHOOK_SECRET', 'paste-a-long-random-secret-here' );
 *   The secret lives in wp-config.php only — never in this file or the database.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sxingxian_sync_notify( $post_id, $action ) {
	if ( ! defined( 'SXINGXIAN_WEBHOOK_URL' ) || ! defined( 'SXINGXIAN_WEBHOOK_SECRET' ) ) {
		return;
	}
	if ( strlen( SXINGXIAN_WEBHOOK_SECRET ) < 32 ) {
		return; // refuse weak secrets
	}
	if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
		return;
	}
	if ( get_post_type( $post_id ) !== 'post' ) {
		return;
	}

	$body      = wp_json_encode( array( 'post_id' => (int) $post_id, 'action' => $action ) );
	$timestamp = (string) time();
	$signature = hash_hmac( 'sha256', $timestamp . '.' . $body, SXINGXIAN_WEBHOOK_SECRET );

	wp_remote_post(
		SXINGXIAN_WEBHOOK_URL,
		array(
			'timeout'   => 3,
			'blocking'  => false,
			'sslverify' => true,
			'headers'   => array(
				'Content-Type'   => 'application/json',
				'X-Sx-Timestamp' => $timestamp,
				'X-Sx-Signature' => 'sha256=' . $signature,
			),
			'body'      => $body,
		)
	);
}

// Published, updated, unpublished (publish -> draft/private/trash), scheduled going live.
add_action(
	'transition_post_status',
	function ( $new_status, $old_status, $post ) {
		if ( 'publish' === $new_status || 'publish' === $old_status ) {
			sxingxian_sync_notify( $post->ID, 'publish' === $new_status ? 'update' : 'unpublish' );
		}
	},
	10,
	3
);

// Edits to an already-published post.
add_action(
	'post_updated',
	function ( $post_id, $post_after, $post_before ) {
		if ( 'publish' === $post_after->post_status && 'publish' === $post_before->post_status ) {
			sxingxian_sync_notify( $post_id, 'update' );
		}
	},
	10,
	3
);

add_action(
	'before_delete_post',
	function ( $post_id ) {
		sxingxian_sync_notify( $post_id, 'delete' );
	}
);
