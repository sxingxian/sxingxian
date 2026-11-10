<?php
/**
 * Plugin Name: sxingxian sync
 * Description: Notifies sxingxian.com when a post is published, updated, unpublished or deleted, so the main site stays in sync. Sends only the post ID — sxingxian.com fetches the post back from the public REST API.
 * Version: 1.1.0
 * Requires at least: 5.6
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

/*
 * Notifications are queued and sent once per post at the end of the request ("shutdown"), when
 * WordPress has finished saving everything. The block editor saves the post first and its featured
 * image, categories and tags just after; notifying at the first step made sxingxian.com fetch the
 * post too early and keep the old featured image (fixed in 1.1.0).
 */
function sxingxian_sync_queue( $post_id, $action ) {
	static $hooked = false;
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return;
	}
	$GLOBALS['sxingxian_sync_queue'][ $post_id ] = $action; // last action wins
	if ( ! $hooked ) {
		$hooked = true;
		add_action(
			'shutdown',
			function () {
				$queue = isset( $GLOBALS['sxingxian_sync_queue'] ) ? (array) $GLOBALS['sxingxian_sync_queue'] : array();
				foreach ( $queue as $id => $act ) {
					sxingxian_sync_notify( (int) $id, (string) $act );
				}
				$GLOBALS['sxingxian_sync_queue'] = array();
			}
		);
	}
}

// Published or updated: runs after the post, its terms, meta and featured image are all saved (WP 5.6+).
add_action(
	'wp_after_insert_post',
	function ( $post_id, $post, $update, $post_before ) {
		if ( 'publish' === $post->post_status ) {
			sxingxian_sync_queue( $post_id, 'update' );
		} elseif ( $post_before && 'publish' === $post_before->post_status ) {
			sxingxian_sync_queue( $post_id, 'unpublish' );
		}
	},
	10,
	4
);

// Unpublished, or a scheduled post going live (cron: no wp_after_insert_post).
add_action(
	'transition_post_status',
	function ( $new_status, $old_status, $post ) {
		if ( 'publish' === $old_status && 'publish' !== $new_status ) {
			sxingxian_sync_queue( $post->ID, 'unpublish' );
		} elseif ( 'future' === $old_status && 'publish' === $new_status ) {
			sxingxian_sync_queue( $post->ID, 'update' );
		}
	},
	10,
	3
);

// Featured image set, changed or removed on its own (e.g. from Quick Edit or another plugin).
$sxingxian_sync_thumb = function ( $meta_id, $object_id, $meta_key ) {
	if ( '_thumbnail_id' === $meta_key && 'publish' === get_post_status( $object_id ) ) {
		sxingxian_sync_queue( $object_id, 'update' );
	}
};
add_action( 'added_post_meta', $sxingxian_sync_thumb, 10, 3 );
add_action( 'updated_post_meta', $sxingxian_sync_thumb, 10, 3 );
add_action( 'deleted_post_meta', $sxingxian_sync_thumb, 10, 3 );

// Deleted: notify straight away, while the post still exists (the queue runs after it is gone).
add_action(
	'before_delete_post',
	function ( $post_id ) {
		unset( $GLOBALS['sxingxian_sync_queue'][ (int) $post_id ] );
		sxingxian_sync_notify( $post_id, 'delete' );
	}
);
